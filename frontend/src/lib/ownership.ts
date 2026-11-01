// Keeps one person's planner data from reaching the next person on the same browser.
// The decision rules live in ownershipRules.ts; this file applies them to the store and the caches.

import { useEffect } from 'react'
import { useStore } from '../store'
import { useAccount, useSession } from './account'
import { clearServerCache } from './cache'
import { decideOwnership } from './ownershipRules'

/** Session-only flag that belongs to one sign-in ("add a photo later"). The new-account marker is left alone: sign-up sets it just before signing in. */
const SESSION_FLAGS = ['wt-photo-later']

/**
 * Removes everything the previous signed-in user left in this browser: the conversation, plan, picks and
 * saved-trip id (memory and localStorage), the access code, the cached account pages and the cached profile.
 * `nextOwner` is the user who is signed in now, or null when nobody is.
 */
export function wipePrivateData(nextOwner: string | null): void {
  useStore.getState().clearPrivate(nextOwner)
  try {
    useStore.persist.clearStorage()
  } catch {
    /* storage unavailable: the in-memory state is already clear */
  }
  clearServerCache()
  useAccount.getState().clear()
  try {
    SESSION_FLAGS.forEach((key) => sessionStorage.removeItem(key))
  } catch {
    /* private mode */
  }
}

/** The traveler chose not to save the guest draft: clear it, keep them signed in and keep the access code. */
export function discardGuestDraft(userId: string): void {
  useStore.getState().clearPrivate(userId, { keepAccessCode: true })
  try {
    useStore.persist.clearStorage()
  } catch {
    /* storage unavailable */
  }
}

/** Runs the ownership rules whenever the sign-in state, the signed-in user or the stored owner changes. */
export function useOwnershipGuard(): void {
  const { loaded, signedIn, userId } = useSession()
  const ownerId = useStore((s) => s.ownerId)
  const hasDraft = useStore((s) => s.messages.some((m) => m.role === 'user') || !!s.plan)

  useEffect(() => {
    const action = decideOwnership({ loaded, signedIn, userId, ownerId, hasDraft })
    if (action === 'wipe') wipePrivateData(signedIn ? userId : null)
    else if (action === 'adopt') useStore.getState().setOwner(userId)
  }, [loaded, signedIn, userId, ownerId, hasDraft])
}
