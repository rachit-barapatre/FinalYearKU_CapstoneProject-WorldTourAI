// Run: npm test   (needs Node 22.6+ for --experimental-strip-types; the rules file is plain TypeScript)
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { canSyncToAccount, decideOwnership } from '../src/lib/ownershipRules.ts'

const A = 'user_A'
const B = 'user_B'
const base = { loaded: true, signedIn: true, userId: A, ownerId: A, hasDraft: true }

describe('who owns the conversation in this browser', () => {
  test('nothing happens until Clerk has loaded', () => {
    assert.equal(decideOwnership({ ...base, loaded: false, signedIn: false, userId: null }), 'none')
  })

  test('signing out clears a signed-in user\'s conversation', () => {
    assert.equal(decideOwnership({ ...base, signedIn: false, userId: null }), 'wipe')
  })

  test('signing out leaves a guest draft alone', () => {
    assert.equal(decideOwnership({ ...base, signedIn: false, userId: null, ownerId: null }), 'none')
  })

  test('a reload after the session ended (stale owner, nobody signed in) is cleared too', () => {
    assert.equal(decideOwnership({ loaded: true, signedIn: false, userId: null, ownerId: A, hasDraft: true }), 'wipe')
  })

  test('a different user signing in never inherits the previous user\'s conversation', () => {
    assert.equal(decideOwnership({ ...base, userId: B, ownerId: A }), 'wipe')
  })

  test('the same user signing back in keeps their own conversation', () => {
    assert.equal(decideOwnership(base), 'none')
  })

  test('a guest draft is never saved silently: signing in asks first', () => {
    assert.equal(decideOwnership({ ...base, ownerId: null }), 'prompt')
  })

  test('an empty store simply becomes the signed-in user\'s', () => {
    assert.equal(decideOwnership({ ...base, ownerId: null, hasDraft: false }), 'adopt')
  })

  test('an unresolved signed-in state (no user id) is treated as signed out', () => {
    assert.equal(decideOwnership({ ...base, userId: null, ownerId: A }), 'wipe')
  })
})

describe('autosave to an account', () => {
  test('only the owner\'s own conversation is saved', () => {
    assert.equal(canSyncToAccount(A, A), true)
  })
  test('another user\'s conversation is never saved', () => {
    assert.equal(canSyncToAccount(A, B), false)
  })
  test('a guest draft is not saved until it is claimed', () => {
    assert.equal(canSyncToAccount(null, A), false)
  })
  test('nobody signed in: nothing is saved', () => {
    assert.equal(canSyncToAccount(A, null), false)
    assert.equal(canSyncToAccount(null, null), false)
  })
})
