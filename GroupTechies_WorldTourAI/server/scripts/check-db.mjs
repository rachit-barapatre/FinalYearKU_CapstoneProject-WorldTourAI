// Checks the MongoDB connection step by step and says which step fails. It never prints the username,
// password or connection string. Run from server/:   npm run check:db
import dns from 'node:dns/promises'
import net from 'node:net'
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { describeDatabaseError, redactSecrets, systemDnsServers } from '../src/db.js'

const uri = process.env.MONGODB_URI || ''
const ok = (text) => console.log(`  [ OK ] ${text}`)
const bad = (text) => console.log(`  [FAIL] ${text}`)
const info = (text) => console.log(`  [    ] ${text}`)
const step = (title) => console.log(`\n${title}`)
const scrub = (text) => redactSecrets(text, uri)
let failed = false

console.log(`Node ${process.version}`)

// 1. What was loaded from server/.env
step('1. MONGODB_URI as loaded by Node')
const match = /^(mongodb(?:\+srv)?):\/\/(.*)$/.exec(uri)
if (!uri) {
  bad('MONGODB_URI is empty or not loaded. Run this from the server folder so .env is found.')
  process.exit(1)
}
if (!match) {
  bad('does not start with mongodb:// or mongodb+srv:// (check for stray quotes, spaces or a hidden character at the start).')
  process.exit(1)
}
const [, scheme, rest] = match
const at = rest.lastIndexOf('@')
const userinfo = at > 0 ? rest.slice(0, at) : ''
const [user = '', ...passParts] = userinfo.split(':')
const password = passParts.join(':')
const afterAt = at > 0 ? rest.slice(at + 1) : rest
const [hostPart, query = ''] = afterAt.split('?')
const [host, dbName = ''] = hostPart.split('/')
ok(`scheme ${scheme}, loaded length ${uri.length}`)
;(uri !== uri.trim() || /[\r\n]/.test(uri) ? bad : ok)(uri !== uri.trim() || /[\r\n]/.test(uri) ? 'the loaded value has a hidden space or line-break character at an end. Remove it from .env.' : 'no hidden whitespace or line break at the ends')
;(rest.split('@').length - 1 === 1 ? ok : bad)(`${rest.split('@').length - 1} "@" sign(s) after the scheme (exactly 1 expected; an extra one means "@" inside the password, which must be written %40)`)
;(user && password ? ok : bad)(`username ${user ? 'present' : 'MISSING'}, password ${password ? `present (${password.length} characters)` : 'MISSING'}`)
const reserved = [...password].filter((c) => ':/?#[]@ %"\'`\\<>{}'.includes(c)).length
;(reserved === 0 ? ok : bad)(reserved === 0 ? 'password has no characters that need URL-encoding' : `password has ${reserved} character(s) that must be URL-encoded (e.g. @ -> %40, # -> %23, / -> %2F, : -> %3A). Easiest fix: set a new password in Atlas using only letters and digits.`)
;(dbName ? ok : info)(dbName ? `database name "${dbName}"` : 'no database name in the URI (MongoDB would use "test")')
info(`options: ${query || 'none'}`)
failed ||= reserved > 0

// 2. DNS: how Node finds the cluster (mongodb+srv only)
const label = (name) => name.replace(/\.mongodb\.net$/, '')
const code = (error) => error?.code || error?.message || 'error'
let targets = host.split(',').filter(Boolean).map((entry) => {
  // A standard (non-srv) string lists the servers itself: host1:27017,host2:27017
  const [name, port] = entry.split(':')
  return { name, port: Number(port) || 27017 }
})
let workingResolver = null // a resolver that answered the SRV lookup (used for the next step)
if (scheme === 'mongodb+srv') {
  step('2. DNS: how Node finds the cluster (SRV and TXT records)')
  const active = dns.getServers()
  info(`Node's DNS servers: ${active.join(', ') || 'none'}${config.dnsServers.length ? '  (from DNS_SERVERS in .env)' : '  (taken from your network adapters)'}`)
  if (config.dnsServers.length) info(`your network adapters would have given Node: ${systemDnsServers.join(', ') || 'none'}`)

  const attempt = async (resolver) => {
    const result = {}
    try {
      result.srv = await resolver.resolveSrv(`_mongodb._tcp.${host}`)
    } catch (error) {
      result.srvError = code(error)
    }
    try {
      result.txt = await resolver.resolveTxt(host)
    } catch (error) {
      result.txtError = code(error)
    }
    return result
  }
  const show = (name, r) => (r.srv ? ok : bad)(`${name}: SRV ${r.srv ? `ok (${r.srv.length} servers)` : `FAILED (${r.srvError})`}, TXT ${r.txt ? 'ok' : `FAILED (${r.txtError})`}`)

  const current = await attempt(dns) // what the MongoDB driver will use
  show("Node's resolver", current)
  if (current.srv) {
    targets = current.srv.map((r) => ({ name: r.name, port: r.port }))
    workingResolver = dns
  } else {
    failed = true
    info('Testing each DNS server on its own, to see which one refuses:')
    const candidates = [...new Set([...systemDnsServers, '8.8.8.8', '1.1.1.1'])]
    const working = []
    for (const server of candidates) {
      const resolver = new dns.Resolver({ timeout: 4000, tries: 1 })
      try {
        resolver.setServers([server])
      } catch {
        info(`${server}: not a usable DNS server address`)
        continue
      }
      const r = await attempt(resolver)
      show(`${server}${systemDnsServers.includes(server) ? ' (from your adapters)' : ' (public)'}`, r)
      if (r.srv) {
        working.push(server)
        workingResolver ??= resolver
        targets = targets.length && targets[0].name !== host ? targets : r.srv.map((x) => ({ name: x.name, port: x.port }))
      }
    }
    if (working.length) {
      const publicOnes = working.filter((w) => !systemDnsServers.includes(w))
      info(`Fix for the SRV lookup: add this line to server/.env  ->  DNS_SERVERS=${(publicOnes.length ? publicOnes : working).join(',')}   then run this check again.`)
    } else {
      info('No DNS server answered the SRV lookup from Node. Check your firewall/antivirus (it may block Node.js on UDP port 53), or use the "standard connection string" from Atlas.')
    }
  }
} else {
  step('2. DNS')
  info('not a +srv connection string, skipped')
}

// 3. The real cluster servers: can this computer find and reach them?
step('3. The cluster servers (host names from the SRV records, port 27017)')
if (!targets.length || (scheme === 'mongodb+srv' && !workingResolver)) {
  info('skipped: the cluster servers are unknown until step 2 works')
} else {
  const checks = await Promise.all(
    targets.slice(0, 3).map(async (target) => {
      const out = { target }
      // The MongoDB driver connects with the operating system's resolver (not the one used for SRV).
      try {
        const found = await dns.lookup(target.name, { all: true })
        out.systemIps = found.map((f) => f.address)
      } catch (error) {
        out.systemError = code(error)
      }
      if (!out.systemIps && workingResolver) {
        try {
          out.otherIps = await workingResolver.resolve4(target.name)
        } catch (error) {
          out.otherError = code(error)
        }
      }
      const ip = out.systemIps?.[0] ?? out.otherIps?.[0]
      out.tcp = ip
        ? await new Promise((resolve) => {
            const socket = net.connect({ host: ip, port: target.port, timeout: 6000 })
            const done = (result) => {
              socket.destroy()
              resolve(result)
            }
            socket.once('connect', () => done('reachable'))
            socket.once('timeout', () => done('timed out'))
            socket.once('error', (error) => done(code(error)))
          })
        : 'not tried'
      return out
    }),
  )
  for (const c of checks) {
    const name = `${label(c.target.name)}:${c.target.port}`
    if (c.systemIps) (c.tcp === 'reachable' ? ok : bad)(`${name}: Windows finds it (${c.systemIps.length} address${c.systemIps.length === 1 ? '' : 'es'}), connection ${c.tcp}`)
    else {
      failed = true
      bad(`${name}: Windows' own DNS cannot find it (${c.systemError})${c.otherIps ? `, but public DNS can (${c.otherIps.length} address(es)); connection to it ${c.tcp}` : ''}`)
    }
  }
  if (checks.some((c) => !c.systemIps && c.otherIps)) {
    info('The MongoDB driver connects using Windows\' own DNS, so DNS_SERVERS alone is not enough here. Set your network adapter\'s DNS to 8.8.8.8 and 1.1.1.1:')
    info('Settings > Network & Internet > Wi-Fi (or Ethernet) > your network > DNS server assignment > Manual > IPv4 on > Preferred 8.8.8.8, Alternate 1.1.1.1. Then run: ipconfig /flushdns')
  } else if (checks.some((c) => c.systemIps && c.tcp !== 'reachable')) {
    failed = true
    info('The names resolve but the connection fails: a firewall, antivirus or VPN blocks outbound port 27017 (try a phone hotspot to confirm), or the Atlas Network Access list does not include your IP.')
  }
}

// 4. The real connection, with the same options the server uses
step('4. Logging in to MongoDB (the same way the server does)')
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1 })
  await mongoose.connection.db.admin().ping()
  ok(`connected, database "${mongoose.connection.name}", ping answered`)
  console.log('\nResult: MongoDB connection works. Restart the server and open /api/health: "database" should say "connected".')
  await mongoose.disconnect()
  process.exit(0)
} catch (error) {
  failed = true
  bad(describeDatabaseError(error, uri))
  info(`error: ${scrub(error?.name)}${error?.code ? ` (code ${scrub(String(error.code))})` : ''}`)
  const servers = error?.reason?.servers instanceof Map ? [...error.reason.servers.entries()] : []
  for (const [address, server] of servers.slice(0, 3)) info(`${label(address.split(':')[0])}: ${server?.type ?? '?'}${server?.error?.message ? ` - ${scrub(server.error.message).slice(0, 140)}` : ''}`)
}

console.log('\nChecks to make in the Atlas website (these cannot be tested from here):')
console.log('  - Database > the cluster is Active, not "Paused" (free clusters pause after inactivity: press Resume).')
console.log('  - Security > Network Access: your current public IP is listed (or "Allow access from anywhere" 0.0.0.0/0 for testing).')
console.log('  - Security > Database Access: the user in MONGODB_URI exists and has "Read and write to any database".')
console.log('  - Passwords are case-sensitive; if unsure, Edit the user > Edit Password and paste the new one into server/.env.')
process.exit(failed ? 1 : 0)
