// One MongoDB connection, reused across requests (and across warm Vercel invocations).
import dns from 'node:dns'
import mongoose from 'mongoose'
import { config } from './config.js'

mongoose.set('strictQuery', true)

/** The DNS servers Node found on this computer, before DNS_SERVERS (if set) replaces them. */
export const systemDnsServers = dns.getServers()

/**
 * Node looks up a mongodb+srv:// cluster with its own resolver, which takes its servers from the network adapters.
 * If one of those refuses SRV lookups (ECONNREFUSED), set DNS_SERVERS=8.8.8.8,1.1.1.1 in .env to use others instead.
 * This only changes Node's lookups in this server process.
 */
export function applyDnsServers(servers = config.dnsServers) {
  if (!servers.length) return false
  try {
    dns.setServers(servers)
    console.log(`[server] DNS_SERVERS set: using ${servers.join(', ')} for DNS lookups from Node`)
    return true
  } catch (error) {
    console.warn(`[server] DNS_SERVERS ignored (${error?.code ?? 'invalid value'}): use IP addresses separated by commas, e.g. 8.8.8.8,1.1.1.1`)
    return false
  }
}
applyDnsServers()

let pending = null

/** Removes the database username, password and connection string from any text before it is shown or logged. */
export function redactSecrets(text, uri = config.mongoUri) {
  let out = String(text ?? '')
  const secrets = new Set()
  if (uri) {
    secrets.add(uri)
    const rest = uri.replace(/^mongodb(\+srv)?:\/\//, '')
    const at = rest.lastIndexOf('@')
    if (at > 0) {
      const userinfo = rest.slice(0, at)
      secrets.add(userinfo)
      const [user, ...pass] = userinfo.split(':')
      const password = pass.join(':')
      for (const part of [user, password]) {
        if (part.length >= 3) secrets.add(part)
      }
      try {
        const decoded = decodeURIComponent(password)
        if (decoded.length >= 3) secrets.add(decoded)
      } catch {
        /* not URL-encoded */
      }
    }
  }
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(secret).join('[redacted]')
  return out.replace(/\/\/[^/@\s]+@/g, '//[redacted]@')
}

/** A short, plain-words reason for a failed connection, with the likely fix. Never contains credentials. */
export function describeDatabaseError(error, uri = config.mongoUri) {
  const servers = error?.reason?.servers instanceof Map ? [...error.reason.servers.values()] : []
  const detail = [error?.name, error?.code, error?.codeName, error?.message, ...servers.map((server) => server?.error?.message)].filter(Boolean).join(' | ')
  const code = error?.code ?? error?.cause?.code
  let reason
  if (/MongoParseError|Invalid (scheme|connection string|URI)|must be a string|is not a valid/i.test(detail)) {
    reason = 'the connection string is malformed. Check MONGODB_URI for stray spaces, quotes or characters.'
  } else if (code === 18 || /bad auth|authentication failed|AuthenticationFailed/i.test(detail)) {
    reason = 'authentication failed: the database username or password is wrong, or that user has no access to this database.'
  } else if (/getaddrinfo|EAI_AGAIN/i.test(detail)) {
    reason = "this computer's own DNS cannot find the cluster's servers (the cluster address itself was found). Set your network adapter's DNS to 8.8.8.8 and 1.1.1.1, then run ipconfig /flushdns."
  } else if (/querySrv|ENOTFOUND|EBADNAME|ENODATA/i.test(detail) || (code === 'ECONNREFUSED' && /_mongodb|srv/i.test(detail))) {
    reason = 'DNS could not find the cluster. The host name in MONGODB_URI may be wrong or the cluster deleted, or Node\'s DNS servers refuse SRV lookups: add DNS_SERVERS=8.8.8.8,1.1.1.1 to server/.env (run npm run check:db for details).'
  } else if (/tlsv1 alert|ssl3|SSL routines|alert internal error|ECONNRESET|socket.*(closed|hang up)|connection.*closed/i.test(detail)) {
    reason = 'Atlas dropped the connection. Usually your current IP is not in Atlas > Network Access, or a firewall/VPN blocks outbound port 27017.'
  } else if (/ECONNREFUSED/i.test(detail)) {
    reason = 'the connection was refused: nothing is listening at that address and port, or a firewall blocks it.'
  } else if (/ETIMEDOUT|timed out|Server selection|ReplicaSetNoPrimary|Could not connect to any servers/i.test(detail)) {
    reason = 'no server answered in time. Check Atlas > Network Access (your IP), that the cluster is not paused, and that outbound port 27017 is open.'
  } else {
    reason = `${error?.name ?? 'Error'}${code ? ` (code ${code})` : ''}`
  }
  return redactSecrets(reason, uri)
}

// The health check can be polled often; one line per half minute is enough to see why the database is unreachable.
let lastLoggedAt = 0
function logFailure(error) {
  if (Date.now() - lastLoggedAt < 30_000) return
  lastLoggedAt = Date.now()
  console.warn(`[server] database unreachable: ${describeDatabaseError(error)}`)
}

// A dropped connection (Atlas idle timeout, rotated password, cold serverless instance) must be
// re-established, not answered with the earlier "connected" promise.
mongoose.connection.on('disconnected', () => {
  pending = null
})

export async function connectDatabase(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection
  if (!uri) throw Object.assign(new Error('The database is not configured (MONGODB_URI is empty).'), { status: 503 })
  if (pending && mongoose.connection.readyState === 0) pending = null
  if (!pending) {
    pending = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      .then(() => mongoose.connection)
      .catch((error) => {
        pending = null
        logFailure(error)
        throw Object.assign(new Error(`Could not reach the database: ${redactSecrets(error.message)}`), { status: 503 })
      })
  }
  return pending
}

export function databaseState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown'
}

export async function disconnectDatabase() {
  pending = null
  await mongoose.disconnect()
}
