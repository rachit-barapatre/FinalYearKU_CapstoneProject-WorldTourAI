// Every trip route must be limited to the signed-in owner. Runs without a database: Trip/User lookups are replaced by
// a stand-in that answers like MongoDB would for the filter it is given, so a route that forgot `user: <me>` would
// hand Alice's trip to Bob and fail here.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { Trip } from '../src/models/Trip.js'
import { User } from '../src/models/User.js'

const alice = { _id: new mongoose.Types.ObjectId(), clerkId: 'user_alice' }
const bob = { _id: new mongoose.Types.ObjectId(), clerkId: 'user_bob' }
const people = [alice, bob]
let trip, filters, saved, deleted
const original = { tripFindOne: Trip.findOne, tripFind: Trip.find, count: Trip.countDocuments, userFindOne: User.findOne, userUpdateOne: User.updateOne, save: Trip.prototype.save, deleteOne: Trip.prototype.deleteOne }

before(() => {
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 }) // connectDatabase() returns at once
  User.findOne = async ({ clerkId }) => {
    const person = people.find((p) => p.clerkId === clerkId)
    return person && { ...person, lastActiveAt: new Date(), toPublic: () => ({}) }
  }
  User.updateOne = () => ({ catch: () => undefined })
  // MongoDB semantics: the trip matches only when every field of the filter equals the stored one.
  const matches = (value, stored) => value === undefined || String(value) === String(stored) // a field left out of the filter matches anything
  Trip.findOne = async (filter) => (matches(filter._id, trip._id) && matches(filter.user, trip.user) ? trip : null)
  Trip.find = (filter) => {
    filters.push(filter)
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, select: async () => (String(filter.user) === String(trip.user) ? [trip] : []) }
    return chain
  }
  Trip.countDocuments = async (filter) => (String(filter.user) === String(trip.user) ? 1 : 0)
  Trip.prototype.save = async function save() {
    saved.push(this)
    return this
  }
  Trip.prototype.deleteOne = async function deleteOne() {
    deleted.push(this)
  }
})

after(() => {
  Object.assign(Trip, { findOne: original.tripFindOne, find: original.tripFind, countDocuments: original.count })
  User.findOne = original.userFindOne
  User.updateOne = original.userUpdateOne
  Trip.prototype.save = original.save
  Trip.prototype.deleteOne = original.deleteOne
  delete mongoose.connection.readyState
})

const fresh = () => {
  filters = []
  saved = []
  deleted = []
  trip = new Trip({ user: alice._id, title: 'Goa', versions: [{ plan: { destination: 'Goa' }, hash: 'h1' }], share: { id: 'shareid123', enabled: true } })
}
const noPhotos = { enabled: false, sign: () => null, destroy: async () => undefined, ownsUrl: () => false }
/** The API as seen by `userId` (null = signed out); Clerk is replaced by this fixed answer. */
const api = (userId) => createApp({ identity: { enabled: true, middleware: (_req, _res, next) => next(), userId: () => userId, getUser: async () => null }, photos: noPhotos })

describe('trip ownership', () => {
  const routes = (t) => [
    ['get', `/api/trips/${t._id}`],
    ['get', `/api/trips/${t._id}/versions/${t.versions[0]._id}`],
    ['put', `/api/trips/${t._id}/sync`, { plan: { destination: 'Hacked', daily_itinerary: [{ day: 1 }] } }],
    ['patch', `/api/trips/${t._id}`, { title: 'Hacked' }],
    ['delete', `/api/trips/${t._id}`],
    ['get', `/api/trips/${t._id}/share`],
    ['post', `/api/trips/${t._id}/share`],
    ['delete', `/api/trips/${t._id}/share`],
  ]
  const send = (user, method, path, body) => {
    const req = request(api(user === 'signed-out' ? null : user))[method](path)
    return body ? req.send(body) : req
  }

  test('the owner can reach every route', async () => {
    fresh()
    for (const [method, path, body] of routes(trip)) {
      const response = await send('user_alice', method, path, body)
      assert.ok(response.status < 300, `${method.toUpperCase()} ${path} gave ${response.status} to the owner`)
    }
  })

  test('another signed-in user gets 404 on every route and changes nothing', async () => {
    fresh()
    for (const [method, path, body] of routes(trip)) {
      const response = await send('user_bob', method, path, body)
      assert.equal(response.status, 404, `${method.toUpperCase()} ${path} gave ${response.status} to a stranger`)
    }
    assert.equal(saved.length, 0, 'a stranger caused a save')
    assert.equal(deleted.length, 0, 'a stranger deleted a trip')
    assert.equal(trip.title, 'Goa')
    assert.equal(trip.share.enabled, true)
  })

  test('nobody who is signed out reaches any route', async () => {
    fresh()
    for (const [method, path, body] of routes(trip)) {
      const response = await send('signed-out', method, path, body)
      assert.equal(response.status, 401, `${method.toUpperCase()} ${path} gave ${response.status} when signed out`)
    }
  })

  test('the list only ever asks for the caller’s own trips', async () => {
    fresh()
    const own = await send('user_alice', 'get', '/api/trips?search=goa&favorite=true')
    assert.equal(own.body.total, 1)
    const other = await send('user_bob', 'get', '/api/trips')
    assert.equal(other.body.total, 0)
    assert.deepEqual(other.body.trips, [])
    assert.ok(filters.every((f) => String(f.user) === String(alice._id) || String(f.user) === String(bob._id)), 'a list query had no user filter')
  })

  test('a new trip belongs to the caller, whatever the body claims', async () => {
    fresh()
    const response = await send('user_bob', 'post', '/api/trips', { messages: [{ role: 'user', content: 'Trip to Rome' }], plan: { destination: 'Rome', daily_itinerary: [{ day: 1 }] }, user: String(alice._id) })
    assert.equal(response.status, 201)
    assert.equal(String(saved.at(-1).user), String(bob._id))
  })

  test('the public share link shows only the shared plan, no account details', async () => {
    fresh()
    const shared = (name) => (filter) => ({ populate: async () => (filter['share.id'] === 'shareid123' && filter['share.enabled'] === true ? { title: 'Goa', versions: trip.versions, selection: null, user: { fullName: name, photo: { url: '' }, email: 'secret@example.com' } } : null) })
    Trip.findOne = shared('Alice Sharma')
    const ok = await request(api(null)).get('/api/share/shareid123')
    assert.equal(ok.status, 200)
    assert.equal(ok.body.trip.sharedBy, 'Alice')
    assert.ok(!JSON.stringify(ok.body).includes('secret@example.com'))
    const off = await request(api(null)).get('/api/share/not-a-link')
    assert.equal(off.status, 404)
    Trip.findOne = shared('')
    const nameless = await request(api(null)).get('/api/share/shareid123')
    assert.equal(nameless.body.trip.sharedBy, 'A WorldTour traveler')
  })
})
