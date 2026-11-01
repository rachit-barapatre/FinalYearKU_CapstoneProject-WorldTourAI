// Rules for saving a trip to the account (frontend/src/lib/saveRules.ts, ownershipRules.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { canSyncToAccount } from '../src/lib/ownershipRules.ts'
import { classifyFailure, MAX_SAVE_RETRIES, newDraftKey, retryDelayMs, saveKey } from '../src/lib/saveRules.ts'

describe('saving trips', () => {
  test('a draft key is accepted by the server and different every time', () => {
    const serverRule = /^[A-Za-z0-9_-]{8,64}$/ // server/src/routes/trips.js
    const keys = new Set(Array.from({ length: 200 }, () => newDraftKey()))
    assert.equal(keys.size, 200)
    for (const key of keys) assert.match(key, serverRule)
  })

  test('failures are told apart: retry what can work, stop what cannot', () => {
    for (const status of [0, 408, 429, 500, 502, 503]) assert.equal(classifyFailure(status), 'retry', String(status))
    assert.equal(classifyFailure(401), 'signed-out')
    assert.equal(classifyFailure(404), 'trip-gone')
    for (const status of [400, 403, 413, 422]) assert.equal(classifyFailure(status), 'permanent', String(status))
  })

  test('retries back off and are limited', () => {
    assert.deepEqual([1, 2, 3].map(retryDelayMs), [3000, 6000, 9000])
    assert.ok(MAX_SAVE_RETRIES >= 3 && MAX_SAVE_RETRIES <= 10)
  })

  test('a change to the conversation, plan or picks changes the save key; nothing new does not', () => {
    const base = { tripId: null, messageCount: 2, lastMessage: 'ready', cost: 500, summary: 'Goa', stage: 'planned', selection: null }
    assert.equal(saveKey(base), saveKey({ ...base }))
    for (const change of [{ tripId: 't1' }, { messageCount: 3 }, { lastMessage: 'x' }, { cost: 600 }, { summary: 'Jaipur' }, { stage: 'collecting' }, { selection: { package: 'budget' } }]) {
      assert.notEqual(saveKey({ ...base, ...change }), saveKey(base), JSON.stringify(change))
    }
  })

  test('only the signed-in owner can save the conversation; a guest draft or another user never syncs', () => {
    assert.equal(canSyncToAccount('user_a', 'user_a'), true)
    assert.equal(canSyncToAccount(null, 'user_a'), false) // guest draft, signed in later: waits for "Save to my account"
    assert.equal(canSyncToAccount('user_a', 'user_b'), false)
    assert.equal(canSyncToAccount('user_a', null), false)
    assert.equal(canSyncToAccount(null, null), false) // a guest
  })
})
