// Who owns the conversation kept in this browser (the planner store, saved in localStorage)?
//
// The store remembers the Clerk user it belongs to (`ownerId`). `null` means a guest draft: something
// planned while nobody was signed in. These rules decide what happens whenever the sign-in state or
// the owner changes. They are plain functions with no imports so they can be unit-tested on their own
// (frontend/test/ownership.test.mjs).

export interface OwnershipInput {
  /** Clerk has finished loading, so `signedIn` can be trusted. */
  loaded: boolean
  signedIn: boolean
  /** The signed-in Clerk user's id (null when signed out). */
  userId: string | null
  /** Whose conversation the store holds (null = a guest draft). */
  ownerId: string | null
  /** The store holds something the traveler typed or a plan. */
  hasDraft: boolean
}

/**
 * - none:   leave the store alone.
 * - wipe:   it holds a signed-in user's data that must not outlive that user's session (they signed out, or a
 *           different user is now signed in). Clear it; a signed-in user then becomes the owner of the empty store.
 * - adopt:  empty store, signed in: the user becomes its owner.
 * - prompt: a guest draft and a signed-in user. Nothing is saved until the traveler chooses to save it.
 */
export type OwnershipAction = 'none' | 'wipe' | 'adopt' | 'prompt'

export function decideOwnership({ loaded, signedIn, userId, ownerId, hasDraft }: OwnershipInput): OwnershipAction {
  if (!loaded) return 'none'
  if (!signedIn || !userId) return ownerId === null ? 'none' : 'wipe'
  if (ownerId === userId) return 'none'
  if (ownerId !== null) return 'wipe'
  return hasDraft ? 'prompt' : 'adopt'
}

/** A conversation is saved to an account only when that same signed-in user owns it. */
export function canSyncToAccount(ownerId: string | null, userId: string | null): boolean {
  return !!userId && ownerId === userId
}
