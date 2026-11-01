// The Profile API behind the Profile and Edit profile pages: the signed-in user's record is created and read by
// their verified Clerk id, edits persist (across a fresh app instance), and sign-in problems answer 401 clearly.
// A stateful in-memory stand-in replaces MongoDB; the real User schema still validates every save.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { User } from '../src/models/User.js'

let users
const original = { findOne: User.findOne, findOneAndUpdate: User.findOneAndUpdate, updateOne: User.updateOne, save: User.prototype.save }
before(() => {
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 })
  User.findOne = async ({ clerkId }) => users.find((u) => u.clerkId === clerkId) ?? null
  User.findOneAndUpdate = async ({ clerkId }, update) => {
    const existing = users.find((u) => u.clerkId === clerkId)
    if (existing) return existing
    const user = new User(update.$setOnInsert)
    user.createdAt = new Date()
    users.push(user)
    return user
  }
  User.updateOne = () => ({ catch: () => undefined })
  User.prototype.save = async function save() {
    await this.validate() // the real schema rules
    return this
  }
})
after(() => {
  Object.assign(User, { findOne: original.findOne, findOneAndUpdate: original.findOneAndUpdate, updateOne: original.updateOne })
  User.prototype.save = original.save
  delete mongoose.connection.readyState
})
beforeEach(() => {
  users = []
  clerkUpdates = []
  clerkDown = false
})

let clerkUpdates, clerkDown
const noPhotos = { enabled: false, sign: () => null, destroy: async () => undefined, ownsUrl: () => false }
const identity = {
  enabled: true,
  middleware: (_req, _res, next) => next(),
  userId: (req) => (req.get('authorization') === 'Bearer good-alice' ? 'user_alice' : req.get('authorization') === 'Bearer good-bob' ? 'user_bob' : null),
  getUser: async (id) => {
    if (clerkDown) throw new Error('Clerk unreachable')
    return { firstName: id === 'user_alice' ? 'Alice' : 'Bob', lastName: 'Traveler', emailAddresses: [{ id: 'e1', emailAddress: `${id}@example.com` }], primaryEmailAddressId: 'e1' }
  },
  updateUser: async (id, data) => {
    if (clerkDown) throw new Error('Clerk unreachable')
    clerkUpdates.push([id, data])
  },
}
let app = createApp({ identity, photos: noPhotos })
const call = (method, path, token, body) => {
  const r = request(app)[method](path)
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body)
}

describe('Profile API', () => {
  test("the signed-in user's own profile is created from Clerk on first sight and returned", async () => {
    const res = await call('get', '/api/me', 'good-alice')
    assert.equal(res.status, 200)
    assert.equal(res.body.user.fullName, 'Alice Traveler')
    assert.equal(res.body.user.email, 'user_alice@example.com')
    assert.equal(users.length, 1)
    assert.equal(users[0].clerkId, 'user_alice')
  })

  test("a different user gets a different profile and never sees the first user's", async () => {
    await call('get', '/api/me', 'good-alice')
    const bob = await call('get', '/api/me', 'good-bob')
    assert.equal(bob.body.user.fullName, 'Bob Traveler')
    assert.equal(users.length, 2)
  })

  test('edits persist: the name, phone and preferences are still there on a fresh app instance (a refresh or re-login)', async () => {
    await call('get', '/api/me', 'good-alice')
    const edited = await call('patch', '/api/me', 'good-alice', { fullName: 'Alice Shah', phone: '+91 98765 43210', preferences: { homeCity: 'Ahmedabad', currency: 'inr', language: 'hi', theme: 'dark' } })
    assert.equal(edited.status, 200)
    app = createApp({ identity, photos: noPhotos })
    const again = (await call('get', '/api/me', 'good-alice')).body.user
    assert.equal(again.fullName, 'Alice Shah')
    assert.equal(again.phone, '+91 98765 43210')
    assert.deepEqual({ ...again.preferences }, { homeCity: 'Ahmedabad', currency: 'INR', language: 'hi', theme: 'dark', readAloud: false })
    assert.deepEqual(clerkUpdates, [['user_alice', { firstName: 'Alice', lastName: 'Shah' }]], 'the Clerk account name follows')
  })

  test("one user's edit does not touch another's profile", async () => {
    await call('get', '/api/me', 'good-alice')
    await call('get', '/api/me', 'good-bob')
    await call('patch', '/api/me', 'good-alice', { fullName: 'Alice Shah' })
    assert.equal((await call('get', '/api/me', 'good-bob')).body.user.fullName, 'Bob Traveler')
  })

  test('the body cannot change who the profile belongs to or the stored email', async () => {
    await call('get', '/api/me', 'good-alice')
    await call('patch', '/api/me', 'good-alice', { fullName: 'Alice Shah', clerkId: 'user_bob', email: 'evil@example.com' })
    assert.equal(users[0].clerkId, 'user_alice')
    assert.equal(users[0].email, 'user_alice@example.com')
  })

  test('invalid edits are refused with a clear message and nothing changes', async () => {
    await call('get', '/api/me', 'good-alice')
    const phone = await call('patch', '/api/me', 'good-alice', { phone: 'call me' })
    const language = await call('patch', '/api/me', 'good-alice', { preferences: { language: 'xx' } })
    const name = await call('patch', '/api/me', 'good-alice', { fullName: 'A' })
    assert.deepEqual([phone.status, language.status, name.status], [400, 400, 400])
    assert.match(phone.body.error, /phone/)
    assert.equal(users[0].fullName, 'Alice Traveler')
  })

  test('Clerk being unreachable does not stop the profile from loading or saving', async () => {
    clerkDown = true
    const first = await call('get', '/api/me', 'good-alice')
    assert.equal(first.status, 200, 'the record is created without the Clerk lookup')
    const edit = await call('patch', '/api/me', 'good-alice', { fullName: 'Alice Shah' })
    assert.equal(edit.status, 200)
    assert.equal(edit.body.user.fullName, 'Alice Shah')
  })

  test('no sign-in at all is "please sign in"; a token the server refuses is a different, accurate message', async () => {
    const none = await call('get', '/api/me', null)
    const bad = await call('get', '/api/me', 'expired-token')
    assert.equal(none.status, 401)
    assert.equal(none.body.error, 'Please sign in to continue.')
    assert.equal(bad.status, 401)
    assert.match(bad.body.error, /verify your sign-in/)
    assert.equal(users.length, 0, 'no record is created for an unverified caller')
  })
})

describe('why a token is refused is logged (never the token)', () => {
  test('the reason from the identity provider is written to the server log', async () => {
    const lines = []
    const warn = console.warn
    console.warn = (...args) => lines.push(args.join(' '))
    const diagnosing = createApp({ identity: { ...identity, diagnose: async (t) => (t === 'expired-token' ? 'token-expired' : '?') }, photos: noPhotos })
    try {
      await request(diagnosing).get('/api/me').set('Authorization', 'Bearer expired-token')
    } finally {
      console.warn = warn
    }
    assert.ok(lines.some((l) => l.includes('token-expired')))
    assert.ok(!lines.join('\n').includes('expired-token'), 'the token itself is never logged')
  })
})
