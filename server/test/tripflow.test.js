// The save-and-fetch flow behind My trips, against a stateful in-memory stand-in for MongoDB (no database needed):
// save a planned trip, list it, read it back after a "refresh", retry without duplicating, and keep users apart.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { config } from '../src/config.js'
import { Trip } from '../src/models/Trip.js'
import { User } from '../src/models/User.js'

const alice = { _id: new mongoose.Types.ObjectId(), clerkId: 'user_alice' }
const bob = { _id: new mongoose.Types.ObjectId(), clerkId: 'user_bob' }
const people = [alice, bob]
let db, raceOnce
const original = { findOne: Trip.findOne, find: Trip.find, count: Trip.countDocuments, userFindOne: User.findOne, userUpdateOne: User.updateOne, save: Trip.prototype.save, deleteOne: Trip.prototype.deleteOne }

const same = (a, b) => String(a) === String(b)
/** MongoDB semantics for the filters the routes use. */
const matches = (trip, filter) =>
  Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return true // search is not exercised here
    if (key === 'status' && value?.$ne) return trip.status !== value.$ne
    if (key === 'status') return trip.status === value
    if (key === 'favorite') return trip.favorite === value
    return same(trip[key], value)
  })

before(() => {
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 })
  User.findOne = async ({ clerkId }) => {
    const person = people.find((p) => p.clerkId === clerkId)
    return person && { ...person, lastActiveAt: new Date(), toPublic: () => ({}) }
  }
  User.updateOne = () => ({ catch: () => undefined })
  Trip.prototype.save = async function save() {
    if (this.clientId && db.some((t) => !same(t._id, this._id) && same(t.user, this.user) && t.clientId === this.clientId)) {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    }
    this.createdAt ??= new Date()
    this.updatedAt = new Date()
    if (!db.some((t) => same(t._id, this._id))) db.push(this)
    return this
  }
  Trip.prototype.deleteOne = async function deleteOne() {
    db = db.filter((t) => !same(t._id, this._id))
  }
  Trip.findOne = async (filter) => {
    if (raceOnce && filter.clientId) {
      raceOnce = false
      return null // the other request has not saved yet when this one looks
    }
    return db.find((t) => matches(t, filter)) ?? null
  }
  Trip.find = (filter) => {
    let rows = db.filter((t) => matches(t, filter))
    const chain = {
      sort: () => { rows = [...rows].sort((a, b) => b.updatedAt - a.updatedAt); return chain },
      skip: (n) => { rows = rows.slice(n); return chain },
      limit: (n) => { rows = rows.slice(0, n); return chain },
      select: async () => rows,
    }
    return chain
  }
  Trip.countDocuments = async (filter) => db.filter((t) => matches(t, filter)).length
})

after(() => {
  Object.assign(Trip, { findOne: original.findOne, find: original.find, countDocuments: original.count })
  User.findOne = original.userFindOne
  User.updateOne = original.userUpdateOne
  Trip.prototype.save = original.save
  Trip.prototype.deleteOne = original.deleteOne
  delete mongoose.connection.readyState
})

beforeEach(() => {
  db = []
  raceOnce = false
})

const noPhotos = { enabled: false, sign: () => null, destroy: async () => undefined, ownsUrl: () => false }
const makeApp = () => createApp({ identity: { enabled: true, middleware: (_req, _res, next) => next(), userId: (req) => req.get('x-test-user') || null, getUser: async () => null }, photos: noPhotos })
let app = makeApp()
const as = (user) => ({
  get: (path) => (user ? request(app).get(path).set('x-test-user', user) : request(app).get(path)),
  post: (path, body) => (user ? request(app).post(path).set('x-test-user', user) : request(app).post(path)).send(body),
  put: (path, body) => request(app).put(path).set('x-test-user', user).send(body),
  delete: (path) => request(app).delete(path).set('x-test-user', user),
})

const plan = (destination = 'Goa', days = 3) => ({
  origin: 'Ahmedabad', destination, cities: [destination], duration: { days }, dates: { start_date: '2026-12-10' }, travelers: 2,
  estimated_cost: 500, usd_to_display: 83, display_currency: 'INR', daily_itinerary: [{ day: 1 }],
})
const snapshot = (extra = {}) => ({
  messages: [{ role: 'user', content: 'Plan 3 days in Goa from Ahmedabad' }, { role: 'assistant', content: 'Your plan is ready.' }],
  session: { stage: 'planned' }, plan: plan(), selection: null, ...extra,
})
const KEY = 'draftkey123456789'

describe('My trips: save and fetch', () => {
  test('a signed-in user with no trips gets an empty list in the shape the page expects', async () => {
    const res = await as('user_alice').get('/api/trips?sort=recent&page=1&limit=12&status=active')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { trips: [], total: 0, page: 1, pages: 1 })
  })

  test('a planned trip is saved to the signed-in user and appears in their list', async () => {
    const saved = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    assert.equal(saved.status, 201)
    assert.equal(String(db[0].user), String(alice._id), 'owned by the authenticated user')
    const list = (await as('user_alice').get('/api/trips?sort=recent&page=1&limit=12&status=active')).body
    assert.equal(list.total, 1)
    const [trip] = list.trips
    assert.equal(trip.id, saved.body.trip.id)
    assert.equal(trip.title, 'Goa · 3 days')
    assert.equal(trip.status, 'planned')
    assert.equal(trip.versions, 1)
    assert.equal(trip.firstPrompt, 'Plan 3 days in Goa from Ahmedabad')
    for (const field of ['id', 'title', 'origin', 'destination', 'durationDays', 'estimatedCost', 'currency', 'favorite', 'shared', 'createdAt', 'updatedAt']) {
      assert.ok(field in trip, `the list item must have "${field}" (the page's TripSummary type)`)
    }
  })

  test('after a refresh (a brand new app instance, same database) the saved trip is still listed and opens with its plan', async () => {
    const saved = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    app = makeApp() // a cold start / reload
    const list = (await as('user_alice').get('/api/trips')).body
    assert.deepEqual(list.trips.map((t) => t.id), [saved.body.trip.id])
    const opened = (await as('user_alice').get(`/api/trips/${saved.body.trip.id}`)).body.trip
    assert.equal(opened.plan.destination, 'Goa')
    assert.equal(opened.messages.length, 2)
  })

  test('saving the same conversation again (retry, lost answer, refresh) never makes a second trip', async () => {
    const first = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    const retry = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    assert.equal(first.status, 201)
    assert.equal(retry.status, 200)
    assert.equal(retry.body.trip.id, first.body.trip.id)
    assert.equal(db.length, 1)
    assert.equal(db[0].versions.length, 1, 'the same plan twice is one version')
  })

  test('a retry that carries a newer plan updates the same trip', async () => {
    const first = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, plan: plan('Goa', 4) }))
    assert.equal(db.length, 1)
    assert.equal(db[0].versions.length, 2)
    assert.equal((await as('user_alice').get(`/api/trips/${first.body.trip.id}`)).body.trip.durationDays, 4)
  })

  test('two saves racing for the same conversation end as one trip', async () => {
    await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    raceOnce = true // this request looks, finds nothing, then loses the race on the unique key
    const second = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    assert.equal(second.status, 200)
    assert.equal(db.length, 1)
  })

  test('syncing an open trip is idempotent and the list reflects the latest state', async () => {
    const { body } = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    const id = body.trip.id
    for (let i = 0; i < 3; i++) assert.equal((await as('user_alice').put(`/api/trips/${id}/sync`, snapshot())).status, 200)
    assert.equal(db[0].versions.length, 1)
    assert.equal((await as('user_alice').get('/api/trips')).body.total, 1)
  })

  test('a very long conversation is saved (most recent messages kept), not refused', async () => {
    const messages = Array.from({ length: config.maxMessages + 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` }))
    const res = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, messages }))
    assert.equal(res.status, 201)
    assert.equal(db[0].messages.length, config.maxMessages)
    assert.equal(db[0].messages.at(-1).content, `message ${messages.length - 1}`)
  })

  test('a malformed draft key is refused clearly', async () => {
    const res = await as('user_alice').post('/api/trips', snapshot({ clientId: 'x' }))
    assert.equal(res.status, 400)
    assert.match(res.body.error, /clientId/)
    assert.equal(db.length, 0)
  })

  test('the first request also works without a draft key (older browser tabs)', async () => {
    assert.equal((await as('user_alice').post('/api/trips', snapshot())).status, 201)
  })
})

describe('My trips: who can see what', () => {
  test('users only see their own trips', async () => {
    await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    await as('user_bob').post('/api/trips', snapshot({ clientId: 'bobsdraftkey12345', plan: plan('Jaipur', 2) }))
    const mine = (await as('user_alice').get('/api/trips')).body
    const his = (await as('user_bob').get('/api/trips')).body
    assert.deepEqual(mine.trips.map((t) => t.destination), ['Goa'])
    assert.deepEqual(his.trips.map((t) => t.destination), ['Jaipur'])
  })

  test("another user cannot open, change, sync or delete a trip, and the list never includes it", async () => {
    const { body } = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    const id = body.trip.id
    assert.equal((await as('user_bob').get(`/api/trips/${id}`)).status, 404)
    assert.equal((await as('user_bob').put(`/api/trips/${id}/sync`, snapshot({ plan: plan('Hacked') }))).status, 404)
    assert.equal((await as('user_bob').delete(`/api/trips/${id}`)).status, 404)
    assert.equal((await as('user_bob').get('/api/trips')).body.total, 0)
    assert.equal(db.length, 1)
    assert.equal(db[0].destination, 'Goa')
  })

  test('an owner id sent in the request body is ignored: the trip belongs to the authenticated user', async () => {
    const res = await as('user_bob').post('/api/trips', snapshot({ clientId: KEY, user: String(alice._id), userId: 'user_alice', clerkId: 'user_alice' }))
    assert.equal(res.status, 201)
    assert.equal(String(db[0].user), String(bob._id))
    assert.equal((await as('user_alice').get('/api/trips')).body.total, 0)
  })

  test("another user's draft key cannot reach or overwrite someone else's trip", async () => {
    await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    const res = await as('user_bob').post('/api/trips', snapshot({ clientId: KEY, plan: plan('Jaipur', 2) }))
    assert.equal(res.status, 201, 'bob gets his own trip')
    assert.equal(db.length, 2)
    assert.deepEqual(db.map((t) => t.destination).sort(), ['Goa', 'Jaipur'])
  })

  test('a guest (no sign-in) can neither save nor list trips, and nothing is stored', async () => {
    assert.equal((await as(null).get('/api/trips')).status, 401)
    assert.equal((await as(null).post('/api/trips', snapshot({ clientId: KEY }))).status, 401)
    assert.equal(db.length, 0)
  })

  test("a guest request cannot borrow a signed-in user's trips", async () => {
    const { body } = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    assert.equal((await as(null).get(`/api/trips/${body.trip.id}`)).status, 401)
  })

  test('deleting a trip removes only that trip, and saving the same draft afterwards creates a fresh one', async () => {
    const first = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    await as('user_alice').post('/api/trips', snapshot({ clientId: 'otherdraftkey1234', plan: plan('Jaipur', 2) }))
    assert.equal((await as('user_alice').delete(`/api/trips/${first.body.trip.id}`)).status, 200)
    assert.deepEqual((await as('user_alice').get('/api/trips')).body.trips.map((t) => t.destination), ['Jaipur'])
    const again = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    assert.equal(again.status, 201)
    assert.notEqual(again.body.trip.id, first.body.trip.id)
  })
})

// ------------------------------------------------------------------ the saved-itinerary library

/** A plan shaped like the real planner's final output, with every kind of field it produces. */
const richPlan = () => ({
  trip_summary: 'Ahmedabad to Goa, 3 days', origin: 'Ahmedabad', destination: 'Goa', cities: ['Goa'], cities_are_suggestions: false,
  dates: { start_date: '2026-12-10', end_date: '2026-12-12' }, duration: { days: 3, nights: 2 }, travelers: 2, pace: 'balanced',
  preferences: ['beaches', 'food'],
  budget: { amount: 60000, currency: 'INR', scope: 'total', user_stated: true, planning_budget: 721 },
  packages: [{ name: 'balanced', label: 'Balanced', total: 480.5, fits_budget: true, hotels: [{ option_id: 'h1', name: 'Hôtel Mar', price_per_night: 55, nights: 2 }] }],
  recommended_package: 'balanced', display_currency: 'INR', usd_to_display: 83,
  selected_flights: [{ option_id: 'f1', airline: 'IndiGo', price: 92, price_is_estimate: true, via: null }], return_flights: [],
  selected_hotels: [{ option_id: 'h1', name: 'Hôtel Mar', data_source: 'live', verified_on_map: true, amenities: ['Wi-Fi', 'Pool'] }],
  ground_options: [{ option_id: 'g1', kind: 'train', label: 'Sleeper', price_pp: 12, duration_minutes: 840, distance_km: 780 }],
  budget_breakdown: [{ category: 'Food', cost: 60, detail: 'about {money:15.00} per person per day' }],
  daily_itinerary: [
    { day: 1, date: '2026-12-10', city: 'Goa', title: 'Arrive & Baga', morning: 'Land', midday: 'Lunch', evening: 'Beach', stay_name: 'Hôtel Mar', activities: [{ activity_id: 'a1', name: 'Baga Beach', start_minute: 900, end_minute: 1080, category: 'sightseeing', detail: 'Sunset ☀️', cost_usd: 0, lat: 15.55, lon: 73.75 }] },
    { day: 2, date: '2026-12-11', city: 'Goa', title: 'Old Goa', morning: 'Church', midday: '', evening: '', stay_name: 'Hôtel Mar', activities: [] },
  ],
  weather_information: { data_source: 'open-meteo', summary: 'Sunny', days: [{ day: 1, date: '2026-12-10', condition: 'Clear', temp_min_c: 21, temp_max_c: 32, precipitation_probability: 5 }] },
  attractions: [{ name: 'Baga Beach', category: 'beach', city: 'Goa' }],
  estimated_cost: 480.5, remaining_budget: 240.5, warnings: ['Schedule check: day 2 is light'], data_notes: ['Flight fares are estimates.'], parser_notes: [],
  provider_information: { flights: 'aviationstack', hotels: 'overpass' }, constraint_violations: [], replanning_history: [],
  algorithms_actually_used: ['dijkstra', 'knapsack'], optimization_metrics: { weights: { cost: 0.4 }, knapsack_value: null },
  verification: {
    levels: { provider: 'Real record from a travel data provider', estimate: 'Calculated here; not a quote' },
    hotels: { level: 'real_hotels_estimated_rates', count: 3, unconfirmed: 0 }, flights: { level: 'provider_schedule_estimated_fares', count: 4 },
    opening_hours: { level: 'not_verified' }, schedule_checks: ['Schedule check: day 2 is light'],
  },
  some_future_field: { nested: [1, 2, { deep: true }], nothing: null },
})

describe('My trips: the complete itinerary is kept and reopened', () => {
  test('every field of the finished plan is stored, and the saved trip reopens with exactly that plan', async () => {
    const original = richPlan()
    const saved = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, plan: original }))
    assert.equal(saved.status, 201)
    app = makeApp() // refresh
    const opened = (await as('user_alice').get(`/api/trips/${saved.body.trip.id}`)).body.trip
    assert.deepEqual(opened.plan, original, 'nothing was dropped, renamed or reshaped')
    assert.deepEqual(opened.plan.verification, original.verification)
    assert.deepEqual(opened.plan.data_notes, ['Flight fares are estimates.'])
    assert.equal(opened.plan.selected_flights[0].price_is_estimate, true, 'estimate labels survive')
    assert.equal(opened.plan.some_future_field.nested[2].deep, true, 'fields this server has never heard of survive')
  })

  test('the real Trip schema keeps the whole plan too (Mongoose casting, no database)', () => {
    const original = richPlan()
    const trip = new Trip({ user: alice._id, versions: [{ plan: original, hash: 'h' }], session: { stage: 'planned', request: { a: 1 } }, selection: { package: 'balanced' } })
    assert.equal(trip.validateSync(), undefined)
    const stored = trip.toObject({ minimize: false })
    assert.deepEqual(JSON.parse(JSON.stringify(stored.versions[0].plan)), original)
    assert.deepEqual(stored.session, { stage: 'planned', request: { a: 1 } })
  })

  test('the list card carries destination, origin, dates, duration, travelers, budget and created date', async () => {
    await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, plan: richPlan() }))
    const [card] = (await as('user_alice').get('/api/trips?status=active')).body.trips
    assert.deepEqual(
      { d: card.destination, o: card.origin, s: card.startDate, e: card.endDate, n: card.durationDays, t: card.travelers, b: card.budget, c: card.budgetCurrency, p: card.preferences },
      { d: 'Goa', o: 'Ahmedabad', s: '2026-12-10', e: '2026-12-12', n: 3, t: 2, b: 60000, c: 'INR', p: ['beaches', 'food'] },
    )
    assert.ok(card.createdAt)
    assert.ok(!('plan' in card), 'the list stays light: the plan is fetched only when a trip is opened')
  })

  test('a plan without a stated budget has no budget on its card (the estimate is not a budget)', async () => {
    const plain = { ...richPlan(), budget: { amount: null, currency: null, scope: null, user_stated: false, planning_budget: 721 } }
    await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, plan: plain }))
    assert.equal(db[0].budget, null)
  })

  test('opening a saved trip only reads it: no new version, nothing rewritten', async () => {
    const { body } = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, plan: richPlan() }))
    const before = JSON.stringify([db[0].versions, db[0].updatedAt, db[0].createdAt])
    for (let i = 0; i < 3; i++) await as('user_alice').get(`/api/trips/${body.trip.id}`)
    assert.equal(JSON.stringify([db[0].versions, db[0].updatedAt, db[0].createdAt]), before)
  })

  test('only a finished itinerary is saved: no plan, an empty timetable or a failed run create nothing', async () => {
    const noPlan = await as('user_alice').post('/api/trips', { messages: snapshot().messages, session: { stage: 'collecting' }, clientId: KEY })
    const noDays = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, plan: { ...plan(), daily_itinerary: [] } }))
    const nullPlan = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY, plan: null }))
    assert.deepEqual([noPlan.status, noDays.status, nullPlan.status], [400, 400, 400])
    assert.equal(db.length, 0)
  })

  test('an earlier conversation-only record is kept but is not listed as an itinerary', async () => {
    db.push(Object.assign(new Trip({ user: alice._id, status: 'planning', firstPrompt: 'old chat' }), { createdAt: new Date(), updatedAt: new Date() }))
    await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    const list = (await as('user_alice').get('/api/trips?status=active')).body
    assert.equal(list.total, 1)
    assert.equal(db.length, 2, 'nothing was deleted')
  })

  test('renaming persists for the owner and not for anyone else', async () => {
    const { body } = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    const patch = (user, title) => request(app).patch(`/api/trips/${body.trip.id}`).set('x-test-user', user).send({ title })
    assert.equal((await patch('user_bob', 'Mine now')).status, 404)
    assert.equal((await patch('user_alice', 'Goa with friends')).status, 200)
    app = makeApp()
    assert.equal((await as('user_alice').get('/api/trips')).body.trips[0].title, 'Goa with friends')
    await as('user_alice').put(`/api/trips/${body.trip.id}/sync`, snapshot({ plan: plan('Goa', 5) }))
    assert.equal((await as('user_alice').get('/api/trips')).body.trips[0].title, 'Goa with friends', 'a re-plan keeps the traveler\'s own name')
  })

  test('a deleted trip is gone from the list and cannot be opened again', async () => {
    const { body } = await as('user_alice').post('/api/trips', snapshot({ clientId: KEY }))
    assert.equal((await as('user_alice').delete(`/api/trips/${body.trip.id}`)).status, 200)
    assert.equal((await as('user_alice').get(`/api/trips/${body.trip.id}`)).status, 404)
    assert.equal((await as('user_alice').get('/api/trips')).body.total, 0)
    assert.equal((await as('user_alice').delete(`/api/trips/${body.trip.id}`)).status, 404)
  })
})
