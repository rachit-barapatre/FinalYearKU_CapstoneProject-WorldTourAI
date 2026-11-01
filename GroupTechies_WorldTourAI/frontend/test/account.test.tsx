// How the browser asks the accounts server for things: the Clerk token, "signed out" versus "a hiccup", and retries.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { connectClerk, server, ServerError, useAccount } from '../src/lib/account'
import { createFakeServer } from './fakeServer'

let api: ReturnType<typeof createFakeServer>
const signedIn = (getToken: (o?: { skipCache?: boolean }) => Promise<string | null> = async () => 'tok-alice') => connectClerk({ loaded: true, signedIn: true, getToken })
beforeEach(() => {
  api = createFakeServer()
  globalThis.fetch = vi.fn(api.handler) as unknown as typeof fetch
  signedIn()
  useAccount.getState().clear()
})
afterEach(() => vi.restoreAllMocks())

describe('talking to the accounts server', () => {
  test('a signed-in request carries the Clerk token and reaches the right user', async () => {
    const { user } = await server<{ user: { id: string } }>('/api/me')
    expect(api.calls[0].auth).toBe('Bearer tok-alice')
    expect(user.id).toBe('user_alice')
  })

  test('signed out really is signed out: no request is sent and the message says so', async () => {
    connectClerk({ loaded: true, signedIn: false, getToken: async () => null })
    await expect(server('/api/me')).rejects.toMatchObject({ status: 401, message: 'Please sign in to continue.' })
    expect(api.calls).toHaveLength(0)
  })

  test('a token that is briefly unavailable is waited for, not reported as "please sign in"', async () => {
    const getToken = vi.fn<(o?: { skipCache?: boolean }) => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue('tok-alice')
    signedIn(getToken)
    await expect(server('/api/me')).resolves.toBeTruthy()
    expect(getToken).toHaveBeenCalledTimes(3)
    expect(api.calls[0].auth).toBe('Bearer tok-alice')
  })

  test('a token that never arrives while Clerk says signed in is a temporary problem (status 0), never a sign-in error', async () => {
    signedIn(async () => null)
    const error = (await server('/api/me').catch((e) => e)) as ServerError
    expect(error.status).toBe(0)
    expect(error.message).not.toMatch(/please sign in/i)
    expect(api.calls).toHaveLength(0)
  })

  test('a page that asks before Clerk has finished loading waits for it, then sends the real token', async () => {
    connectClerk({ loaded: false, signedIn: false, getToken: async () => null })
    const pending = server<{ user: { id: string } }>('/api/me')
    await new Promise((r) => setTimeout(r, 1800)) // longer than any token retry: only waiting for Clerk itself can succeed
    expect(api.calls).toHaveLength(0) // nothing was sent with an empty token
    signedIn()
    expect((await pending).user.id).toBe('user_alice')
    expect(api.calls[0].auth).toBe('Bearer tok-alice')
  })

  test('a 401 for an expired token is retried once with a fresh token', async () => {
    const seen: (boolean | undefined)[] = []
    signedIn(async (o) => {
      seen.push(o?.skipCache)
      return seen.length === 1 ? 'stale' : 'tok-alice'
    })
    await expect(server('/api/me')).resolves.toBeTruthy()
    expect(seen).toEqual([false, true])
    expect(api.calls.map((c) => c.auth)).toEqual(['Bearer stale', 'Bearer tok-alice'])
  })

  test('a token the server keeps refusing ends as a clear 401 with the server\'s own accurate message', async () => {
    api.state.rejectToken = true
    const error = (await server('/api/me').catch((e) => e)) as ServerError
    expect(error.status).toBe(401)
    expect(error.message).toMatch(/verify your sign-in/)
    expect(api.calls).toHaveLength(2) // once, then once more with a fresh token, then it stops
  })

  test('a dropped connection while reading is retried and then succeeds', async () => {
    api.state.down = true
    setTimeout(() => (api.state.down = false), 300)
    await expect(server('/api/me')).resolves.toBeTruthy()
    expect(api.calls.length).toBeGreaterThan(1)
  })

  test('a connection that stays down is a network message, not a sign-in message', async () => {
    api.state.down = true
    const error = (await server('/api/me').catch((e) => e)) as ServerError
    expect(error.status).toBe(0)
    expect(error.message).toMatch(/reach WorldTour/)
    expect(error.message).not.toMatch(/sign in/i)
  })

  test('a write that fails on the network is not silently repeated by the helper (the caller decides)', async () => {
    api.state.down = true
    await expect(server('/api/me', { method: 'PATCH', body: { fullName: 'A B' } })).rejects.toMatchObject({ status: 0 })
    expect(api.calls).toHaveLength(1)
  })
})

describe('the profile', () => {
  test('refresh loads the signed-in user\'s profile', async () => {
    await useAccount.getState().refresh()
    expect(useAccount.getState().profile?.id).toBe('user_alice')
    expect(useAccount.getState().error).toBeNull()
  })

  test('a failed refresh keeps the profile already shown and reports the real reason', async () => {
    await useAccount.getState().refresh()
    api.state.down = true
    await useAccount.getState().refresh()
    const s = useAccount.getState()
    expect(s.profile?.id).toBe('user_alice')
    expect(s.error).toMatch(/reach WorldTour/)
  })

  test('edits are sent to the server and are still there after a "reload" (empty store, fresh load)', async () => {
    await useAccount.getState().refresh()
    await useAccount.getState().update({ fullName: 'Alice Shah', phone: '+91 98765 43210', preferences: { homeCity: 'Ahmedabad', currency: 'INR' } })
    const patch = api.calls.find((c) => c.method === 'PATCH')!
    expect(patch.auth).toBe('Bearer tok-alice')
    expect(patch.body).toEqual({ fullName: 'Alice Shah', phone: '+91 98765 43210', preferences: { homeCity: 'Ahmedabad', currency: 'INR' } })
    useAccount.getState().clear() // a page reload loses the in-memory profile
    await useAccount.getState().refresh()
    expect(useAccount.getState().profile).toMatchObject({ fullName: 'Alice Shah', phone: '+91 98765 43210', preferences: { homeCity: 'Ahmedabad', currency: 'INR' } })
  })

  test('another user signing in gets their own profile, not the first user\'s', async () => {
    await useAccount.getState().refresh()
    await useAccount.getState().update({ fullName: 'Alice Shah' })
    useAccount.getState().clear()
    signedIn(async () => 'tok-bob')
    await useAccount.getState().refresh()
    expect(useAccount.getState().profile?.id).toBe('user_bob')
    expect(useAccount.getState().profile?.fullName).toBe('bob Traveler')
  })

  test('a failed edit is reported to the caller and leaves the profile unchanged', async () => {
    await useAccount.getState().refresh()
    api.state.down = true
    await expect(useAccount.getState().update({ fullName: 'Nope Nope' })).rejects.toBeInstanceOf(ServerError)
    expect(useAccount.getState().profile?.fullName).toBe('alice Traveler')
  })
})
