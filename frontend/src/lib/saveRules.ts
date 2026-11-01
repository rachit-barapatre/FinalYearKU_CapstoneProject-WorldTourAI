// Plain rules for saving a trip to the account, kept free of imports so they can be unit-tested on their own
// (frontend/test/tripSave.test.mjs).

/** A random name for one conversation, sent with the "create trip" request so a repeat of it cannot make a second trip. */
export function newDraftKey(random: () => number = Math.random): string {
  const part = () => Math.floor(random() * 0x100000000).toString(36).padStart(7, '0')
  return `d${part()}${part()}${part()}`.slice(0, 32)
}

/** 401: not signed in (stop, the sign-in flow handles it). 404: the trip was deleted elsewhere (start a new one).
 *  Other 4xx (too large, invalid): sending the same thing again can never work. */
export type FailureKind = 'retry' | 'signed-out' | 'trip-gone' | 'permanent'

export function classifyFailure(status: number): FailureKind {
  if (status === 401) return 'signed-out'
  if (status === 404) return 'trip-gone'
  if (status === 408 || status === 429 || status === 0 || status >= 500) return 'retry'
  if (status >= 400) return 'permanent'
  return 'retry'
}

export const MAX_SAVE_RETRIES = 5

/** Wait before retry number `failures` (1-based): 3 s, 6 s, 9 s ... */
export const retryDelayMs = (failures: number) => 3000 * failures

/** What changed since the last successful save? Same key = nothing new to send. */
export function saveKey(parts: {
  tripId: string | null
  messageCount: number
  lastMessage: string | undefined
  cost: unknown
  summary: unknown
  stage: unknown
  selection: unknown
}): string {
  return JSON.stringify([parts.tripId, parts.messageCount, parts.lastMessage, parts.cost, parts.summary, parts.stage, parts.selection])
}

export const SAVE_FAILED_MESSAGE = "We couldn't save this trip to your account. It is still here on this device; we'll try again when you make another change."
export const SAVE_REJECTED_MESSAGE = "This trip couldn't be saved to your account (the server refused it). Your plan is still here; please try planning again."

/** Only a finished itinerary (at least one day in the timetable) becomes a saved trip, never a half-made or failed run. */
export function isFinishedPlan(plan: { daily_itinerary?: unknown } | null | undefined): boolean {
  return !!plan && Array.isArray(plan.daily_itinerary) && plan.daily_itinerary.length > 0
}

/** What the traveler is told when saving failed, by what went wrong. Never silent, never blaming sign-in for a network blip. */
export function describeSaveFailure(status: number): string {
  if (status === 401) return "We couldn't verify your sign-in, so this itinerary isn't saved yet. Refresh the page, or sign out and back in, then try again."
  if (status === 413) return 'This itinerary is too large to save.'
  if (status === 400 || status === 422) return "The server didn't accept this itinerary. Please plan it again."
  if (status === 503) return 'Your account storage is unavailable right now, so this itinerary is not saved yet.'
  return "We couldn't reach your account to save this itinerary. Check your connection and try again."
}
