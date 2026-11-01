// Saves every finished itinerary to the signed-in traveler's My trips, with its complete output (the whole plan the
// planner produced, the traveler's picks, and the request it came from), so it can be reopened later without
// planning again. Only a finished itinerary is saved: talking to the assistant, or a run that failed, saves nothing.
// Guests are not saved. A trip planned as a guest is saved only after the traveler chooses "Save to my account"
// (components/GuestTripPrompt.tsx), and a conversation is only ever saved to the account that owns it
// (lib/ownershipRules.ts), never to whoever happens to be signed in next.
//
// The owner of a saved trip is decided by the server from the verified Clerk session; nothing sent from here
// can change it. A retry cannot duplicate a trip: the first save carries `clientId` (the draft key, kept across
// page refreshes) and the server returns the trip it already made for that key.
// The outcome is always visible (components/SaveStatus.tsx): saving, saved, or an error with "Try again".

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { server, ServerError, useSession } from './account'
import { invalidate } from './cache'
import { canSyncToAccount } from './ownershipRules'
import { classifyFailure, describeSaveFailure, isFinishedPlan, MAX_SAVE_RETRIES, newDraftKey, retryDelayMs, SAVE_FAILED_MESSAGE, SAVE_REJECTED_MESSAGE, saveKey } from './saveRules'
import { useSaveStatus } from './saveStatus'
import { toast } from './toast'

const DELAY_MS = 1500

export function useTripSync(): void {
  const { enabled, signedIn, userId } = useSession()
  const ownerId = useStore((s) => s.ownerId)
  const messages = useStore((s) => s.messages)
  const session = useStore((s) => s.session)
  const plan = useStore((s) => s.plan)
  const selection = useStore((s) => s.selection)
  const status = useStore((s) => s.status)
  const tripId = useStore((s) => s.tripId)
  const setTripId = useStore((s) => s.setTripId)
  const retryTick = useSaveStatus((s) => s.retryTick)
  const creating = useRef(false)
  const lastSent = useRef('')
  const lastTick = useRef(retryTick)
  // A failed save (cold server, network blip) is retried a few times instead of waiting for the next change.
  const [attempt, setAttempt] = useState(0)
  const failures = useRef(0)
  const warned = useRef('')

  useEffect(() => {
    if (!enabled || !signedIn || !canSyncToAccount(ownerId, userId) || status !== 'idle') return
    if (!isFinishedPlan(plan)) {
      useSaveStatus.getState().idle()
      return
    }
    // "Try again" asks for a fresh attempt even though nothing changed.
    if (lastTick.current !== retryTick) {
      lastTick.current = retryTick
      lastSent.current = ''
      failures.current = 0
      warned.current = ''
    }
    const sent = messages.filter((m) => !m.failed && m.content.trim())
    const body = {
      messages: sent.map((m) => ({ role: m.role, content: m.content.slice(0, 8000), at: m.at })),
      session,
      plan,
      selection: selection ? { ...selection } : null,
    }
    const key = saveKey({
      tripId,
      messageCount: body.messages.length,
      lastMessage: body.messages.at(-1)?.content,
      cost: plan?.estimated_cost,
      summary: plan?.trip_summary,
      stage: session?.stage,
      selection,
    })
    if (key === lastSent.current) return
    const owner = userId
    // The account may have changed while a save was on its way: its answer then belongs to no one here.
    const stillOwner = () => useStore.getState().ownerId === owner
    useSaveStatus.getState().saving()
    const timer = setTimeout(async () => {
      try {
        let savedId = tripId
        if (!tripId) {
          if (creating.current) return
          creating.current = true
          const draftKey = useStore.getState().draftKey ?? newDraftKey()
          useStore.getState().setDraftKey(draftKey)
          const { trip } = await server<{ trip: { id: string } }>('/api/trips', { method: 'POST', body: { ...body, clientId: draftKey } })
          savedId = trip.id
          if (stillOwner()) setTripId(trip.id)
        } else {
          await server(`/api/trips/${tripId}/sync`, { method: 'PUT', body })
        }
        if (!stillOwner()) return
        lastSent.current = key
        failures.current = 0
        warned.current = ''
        useSaveStatus.getState().saved(savedId)
        // My trips and the profile counts were cached before this trip existed.
        invalidate('/api/trips?')
        invalidate('/api/stats')
      } catch (error) {
        if (!stillOwner()) return
        const code = error instanceof ServerError ? error.status : 0
        const kind = classifyFailure(code)
        if (kind === 'trip-gone') {
          // A trip deleted from My trips while still open here: save it again as a fresh trip.
          setTripId(null)
          useStore.getState().setDraftKey(null)
          lastSent.current = ''
          setAttempt((n) => n + 1)
        } else if (kind === 'retry' && failures.current < MAX_SAVE_RETRIES) {
          failures.current += 1
          setTimeout(() => setAttempt((n) => n + 1), retryDelayMs(failures.current))
        } else {
          // Signed-out, refused for good, or out of retries: said out loud, with a button to try again.
          useSaveStatus.getState().failed(describeSaveFailure(code))
          if (warned.current !== key) toast.error(kind === 'permanent' ? SAVE_REJECTED_MESSAGE : SAVE_FAILED_MESSAGE)
          warned.current = key
        }
      } finally {
        creating.current = false
      }
    }, DELAY_MS)
    return () => clearTimeout(timer)
  }, [enabled, signedIn, userId, ownerId, status, messages, session, plan, selection, tripId, setTripId, attempt, retryTick])
}
