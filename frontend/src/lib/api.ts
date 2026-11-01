import type { AgentEvent, ChatResponse, Plan, Session } from './types'

// In production VITE_API_URL is the backend's address (e.g. https://world-tour-nine.vercel.app).
// In development it is empty and Vite proxies /api to the local Python server.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

const NETWORK_MESSAGE = "We couldn't reach the planner just now. It's usually a brief network hiccup — please try again."
const RETRYABLE = new Set([502, 503, 504])
// The server sends a heartbeat line every 5 s while planning; this much silence means the connection is dead.
const STALL_MS = 20000

export class ApiError extends Error {
  status: number
  /** True when the request never got a usable answer (offline, dropped, timed out). */
  network: boolean
  constructor(message: string, status: number, network = false) {
    super(message)
    this.status = status
    this.network = network
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves once the browser is back online (or after maxMs), so retries don't burn out during an outage. */
function backOnline(maxMs = 45000): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      window.removeEventListener('online', done)
      resolve()
    }
    const timer = setTimeout(done, maxMs)
    window.addEventListener('online', done)
  })
}

function headers(accessCode: string | null): HeadersInit {
  return { 'Content-Type': 'application/json', ...(accessCode ? { 'X-Access-Code': accessCode } : {}) }
}

/**
 * fetch with a time limit (until the response headers arrive) and automatic retries.
 * Retries on network failures (offline, dropped connection, cold start) and on 502/503/504
 * from the hosting edge, with a short back-off. Other HTTP errors are returned as-is.
 */
async function request(path: string, init: RequestInit, { retries = 2, timeoutMs = 60000 } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${BASE}${path}`, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (RETRYABLE.has(response.status) && attempt < retries) {
        await wait(800 * 2 ** attempt)
        continue
      }
      return response
    } catch (error) {
      clearTimeout(timer)
      if (attempt < retries) {
        await backOnline()
        await wait(800 * 2 ** attempt)
        continue
      }
      const timedOut = error instanceof DOMException && error.name === 'AbortError'
      throw new ApiError(timedOut ? 'The planner took too long to answer. Please try again.' : NETWORK_MESSAGE, 0, true)
    }
  }
}

async function fail(response: Response): Promise<never> {
  let detail = `Request failed (${response.status})`
  try {
    const body = await response.json()
    if (body?.detail) detail = String(body.detail)
  } catch {
    if (RETRYABLE.has(response.status)) detail = NETWORK_MESSAGE
  }
  throw new ApiError(detail, response.status, RETRYABLE.has(response.status))
}

export async function health(): Promise<{ status: string; access_code_required: boolean }> {
  const response = await request('/api/health', {}, { retries: 1, timeoutMs: 20000 })
  if (!response.ok) await fail(response)
  return response.json()
}

/** A signed-in traveler's saved home city and currency, sent with chat messages as defaults. */
let chatDefaults: { home_city?: string; currency?: string } = {}
export function setChatDefaults(defaults: { home_city?: string; currency?: string }) {
  chatDefaults = defaults
}

export async function sendChat(session: Session | null, message: string, accessCode: string | null, language = 'en'): Promise<ChatResponse> {
  // The chat step is stateless (the session travels with the request), so retrying is safe.
  const response = await request(
    '/api/chat',
    { method: 'POST', headers: headers(accessCode), body: JSON.stringify({ session, message, language, ...chatDefaults }) },
    { retries: 2, timeoutMs: 30000 },
  )
  if (!response.ok) await fail(response)
  return response.json()
}

async function planOnce(session: Session, accessCode: string | null, onEvent: (event: AgentEvent) => void) {
  const response = await request(
    '/api/plan',
    { method: 'POST', headers: headers(accessCode), body: JSON.stringify({ session }) },
    { retries: 2, timeoutMs: 30000 },
  )
  if (!response.ok || !response.body) await fail(response)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: { plan: Plan; session: Session } | null = null
  const handle = (line: string) => {
    if (!line.trim()) return
    const message = JSON.parse(line)
    if (message.type === 'event') onEvent(message.event)
    else if (message.type === 'plan') result = { plan: message.plan, session: message.session }
    else if (message.type === 'error') throw new ApiError(message.message, 500)
    // "ping" lines only keep the connection alive.
  }
  // A dropped connection can leave the read hanging instead of failing, so cancel it after a silent spell.
  let watchdog = setTimeout(() => void reader.cancel(), STALL_MS)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      clearTimeout(watchdog)
      watchdog = setTimeout(() => void reader.cancel(), STALL_MS)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(handle)
    }
    handle(buffer)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(NETWORK_MESSAGE, 0, true)
  } finally {
    clearTimeout(watchdog)
  }
  if (!result) throw new ApiError(NETWORK_MESSAGE, 0, true)
  return result as { plan: Plan; session: Session }
}

/**
 * Runs the workflow. Progress events arrive one per line (NDJSON) while the plan is built.
 * If the connection drops or stalls before the plan arrives, it starts again (up to twice) automatically.
 */
export async function runPlan(
  session: Session,
  accessCode: string | null,
  onEvent: (event: AgentEvent) => void,
  onRestart?: () => void,
): Promise<{ plan: Plan; session: Session }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await planOnce(session, accessCode, onEvent)
    } catch (error) {
      if (!(error instanceof ApiError) || !error.network || attempt >= 2) throw error
      onRestart?.()
      await backOnline()
      await wait(1500 * (attempt + 1))
    }
  }
}
