// A controllable stand-in for Clerk's React hooks: tests decide who is signed in and what token they get.
export const clerk = {
  isLoaded: true,
  isSignedIn: true,
  userId: 'user_alice' as string | null,
  token: 'tok-alice' as string | null,
  /** Called for every token request: lets a test make the token slow, missing or one-time unavailable. */
  getToken: undefined as undefined | ((options?: { skipCache?: boolean }) => Promise<string | null>),
}
export const tokenCalls: { skipCache?: boolean }[] = []
export function resetClerk() {
  Object.assign(clerk, { isLoaded: true, isSignedIn: true, userId: 'user_alice', token: 'tok-alice', getToken: undefined })
  tokenCalls.length = 0
}
