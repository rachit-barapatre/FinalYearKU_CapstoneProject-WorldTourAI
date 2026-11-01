// End-to-end tests of the API against an in-memory MongoDB, with stand-ins for Clerk and Cloudinary.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { MongoMemoryServer } from 'mongodb-memory-server-core'
import request from 'supertest'

const WEBHOOK_SECRET = 'whsec_' + Buffer.from('worldtour-test-webhook-secret-123456').toString('base64')
let mongo, app, calls, photos, Webhook, disconnect

const PROFILES = {
  user_alice: { firstName: 'Alice', lastName: 'Sharma', emailAddresses: [{ id: 'e1', emailAddress: 'Alice@Example.com' }], primaryEmailAddressId: 'e1', unsafeMetadata: { phone: '+91 98765 43210' } },
  user_bob: { firstName: 'Bob', lastName: '', emailAddresses: [{ id: 'e2', emailAddress: 'bob@example.com' }], primaryEmailAddressId: 'e2', unsafeMetadata: {} },
}

before(async () => {
  // A real database can be used instead of the in-memory one: TEST_MONGODB_URI=mongodb+srv://.../worldtour-test
  if (process.env.TEST_MONGODB_URI) {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI
  } else {
    mongo = await MongoMemoryServer.create()
    process.env.MONGODB_URI = mongo.getUri('worldtour-test')
  }
  process.env.CLERK_WEBHOOK_SIGNING_SECRET = WEBHOOK_SECRET
  process.env.CLOUDINARY_FOLDER = 'worldtour/avatars'
  process.env.APP_URL = 'https://worldtour-xi.vercel.app'
  ;({ Webhook } = await import('svix'))
  const { createApp } = await import('../src/app.js')
  ;({ disconnectDatabase: disconnect } = await import('../src/db.js'))
  calls = { updateUser: [], deleteUser: [], destroyed: [] }
  const identity = {
    enabled: true,
    middleware: (_req, _res, next) => next(),
    userId: (req) => req.get('x-test-user') || null,
    getUser: async (id) => PROFILES[id] ?? null,
    updateUser: async (id, data) => calls.updateUser.push({ id, data }),
    deleteUser: async (id) => calls.deleteUser.push(id),
  }
  photos = {
    enabled: true,
    sign: (clerkId) => ({ uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload', publicId: `worldtour/avatars/${clerkId}-1700000000`, signature: 'sig', timestamp: 1700000000, apiKey: 'k', cloudName: 'demo' }),
    destroy: async (publicId) => publicId && calls.destroyed.push(publicId),
    ownsUrl: (url, publicId) => url.startsWith('https://res.cloudinary.com/demo/image/upload/') && url.includes(publicId),
  }
  app = createApp({ identity, photos })
})

after(async () => {
  if (process.env.TEST_MONGODB_URI) {
    const mongoose = (await import('mongoose')).default
    await mongoose.connection.db?.dropDatabase().catch(() => undefined)
  }
  await disconnect?.()
  await mongo?.stop()
})

const as = (user) => ({
  get: (path) => request(app).get(path).set('x-test-user', user),
  post: (path) => request(app).post(path).set('x-test-user', user),
  put: (path) => request(app).put(path).set('x-test-user', user),
  patch: (path) => request(app).patch(path).set('x-test-user', user),
  delete: (path) => request(app).delete(path).set('x-test-user', user),
})
const alice = as('user_alice')
const bob = as('user_bob')

const plan = (cost, destination = 'Goa') => ({
  trip_summary: `Plan for ${destination}, 4 days`,
  origin: 'Mumbai',
  destination,
  cities: [],
  duration: { days: 4, nights: 3 },
  dates: { start_date: '2026-12-12', end_date: '2026-12-15' },
  travelers: 2,
  estimated_cost: cost,
  usd_to_display: 85,
  display_currency: 'INR',
  daily_itinerary: [],
})
const conversation = [
  { role: 'user', content: 'goa frm mumbai 4day 2ppl 40k', at: '2026-10-24T10:00:00Z' },
  { role: 'assistant', content: 'Great, I have everything I need.', at: '2026-10-24T10:00:01Z' },
]

describe('accounts', () => {
  test('health reports configuration without keys', async () => {
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.body.database, 'connected')
    assert.equal(res.body.clerkWebhook, true)
    assert.ok(!JSON.stringify(res.body).includes(WEBHOOK_SECRET))
  })

  test('signed-in routes need a user', async () => {
    const res = await request(app).get('/api/me')
    assert.equal(res.status, 401)
    assert.match(res.body.error, /sign in/i)
  })

  test('first request creates the profile from Clerk, phone included', async () => {
    const res = await alice.get('/api/me')
    assert.equal(res.status, 200)
    assert.equal(res.body.user.fullName, 'Alice Sharma')
    assert.equal(res.body.user.email, 'alice@example.com')
    assert.equal(res.body.user.phone, '+91 98765 43210')
    assert.equal(res.body.user.onboarded, false)
    assert.equal(res.body.user.preferences.language, 'en')
  })

  test('settings: validation, update, and the name is copied to Clerk', async () => {
    const bad = await alice.patch('/api/me').send({ phone: 'call me' })
    assert.equal(bad.status, 400)
    assert.match(bad.body.error, /phone/)
    const res = await alice
      .patch('/api/me')
      .send({ fullName: 'Alice R Sharma', phone: '+91 90000 11111', preferences: { homeCity: 'Pune', currency: 'inr', language: 'gu', theme: 'dark', readAloud: true } })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.user.preferences, { homeCity: 'Pune', currency: 'INR', language: 'gu', theme: 'dark', readAloud: true })
    assert.deepEqual(calls.updateUser.at(-1), { id: 'user_alice', data: { firstName: 'Alice', lastName: 'R Sharma' } })
  })

  test('photo: signed upload, only your own photo is accepted, old photo is removed', async () => {
    const sign = await alice.post('/api/me/photo/sign')
    assert.equal(sign.status, 200)
    const theirs = await alice.patch('/api/me/photo').send({ publicId: 'worldtour/avatars/user_bob-1', url: 'https://res.cloudinary.com/demo/image/upload/v1/worldtour/avatars/user_bob-1.jpg' })
    assert.equal(theirs.status, 400)
    const first = await alice.patch('/api/me/photo').send({ publicId: 'worldtour/avatars/user_alice-1', url: 'https://res.cloudinary.com/demo/image/upload/v1/worldtour/avatars/user_alice-1.jpg' })
    assert.equal(first.status, 200)
    assert.match(first.body.user.photoUrl, /c_fill,g_face,w_256,h_256/)
    assert.equal(first.body.user.onboarded, true)
    await alice.patch('/api/me/photo').send({ publicId: 'worldtour/avatars/user_alice-2', url: 'https://res.cloudinary.com/demo/image/upload/v2/worldtour/avatars/user_alice-2.jpg' })
    assert.ok(calls.destroyed.includes('worldtour/avatars/user_alice-1'))
  })
})

describe('trips', () => {
  let tripId

  test('a conversation is saved before any plan exists', async () => {
    const res = await alice.post('/api/trips').send({ messages: conversation, session: { stage: 'ready', request: { origin: 'Mumbai', destination: 'Goa', duration_days: 4 } } })
    assert.equal(res.status, 201)
    tripId = res.body.trip.id
    assert.equal(res.body.trip.status, 'planning')
    assert.equal(res.body.trip.title, 'Goa · 4 days')
    assert.equal(res.body.trip.firstPrompt, 'goa frm mumbai 4day 2ppl 40k')
  })

  test('each new plan is a version; the same plan twice is not', async () => {
    let res = await alice.put(`/api/trips/${tripId}/sync`).send({ messages: conversation, plan: plan(400) })
    assert.equal(res.body.trip.versions, 1)
    assert.equal(res.body.trip.estimatedCost, 34000)
    res = await alice.put(`/api/trips/${tripId}/sync`).send({ messages: conversation, plan: plan(400) })
    assert.equal(res.body.trip.versions, 1)
    const more = [...conversation, { role: 'user', content: 'premium' }, { role: 'assistant', content: 'Updating the plan.' }]
    res = await alice.put(`/api/trips/${tripId}/sync`).send({ messages: more, plan: plan(700), selection: { package: 'premium' } })
    assert.equal(res.body.trip.versions, 2)
    assert.equal(res.body.trip.status, 'planned')
    const detail = await alice.get(`/api/trips/${tripId}`)
    assert.equal(detail.body.trip.messages.length, 4)
    assert.equal(detail.body.trip.versionList[1].prompt, 'premium')
    assert.equal(detail.body.trip.plan.estimated_cost, 700)
    assert.deepEqual(detail.body.trip.selection, { package: 'premium' })
    const first = await alice.get(`/api/trips/${tripId}/versions/${detail.body.trip.versionList[0].id}`)
    assert.equal(first.body.version.plan.estimated_cost, 400)
  })

  test('history: list, search, favourite, rename', async () => {
    await alice.post('/api/trips').send({ messages: [{ role: 'user', content: 'Jaipur from Delhi 3 days' }], plan: plan(300, 'Jaipur') })
    let res = await alice.get('/api/trips')
    assert.equal(res.body.total, 2)
    assert.equal(res.body.trips[0].destination, 'Jaipur')
    res = await alice.get('/api/trips?search=goa')
    assert.deepEqual(res.body.trips.map((t) => t.destination), ['Goa'])
    await alice.patch(`/api/trips/${tripId}`).send({ favorite: true, title: 'Anniversary in Goa' })
    res = await alice.get('/api/trips?favorite=true')
    assert.equal(res.body.trips[0].title, 'Anniversary in Goa')
    res = await alice.put(`/api/trips/${tripId}/sync`).send({ plan: plan(710) })
    assert.equal(res.body.trip.title, 'Anniversary in Goa')
  })

  test('another user cannot see or change the trip', async () => {
    assert.equal((await bob.get(`/api/trips/${tripId}`)).status, 404)
    assert.equal((await bob.put(`/api/trips/${tripId}/sync`).send({ plan: plan(1) })).status, 404)
    assert.equal((await bob.delete(`/api/trips/${tripId}`)).status, 404)
    assert.equal((await bob.get('/api/trips')).body.total, 0)
    assert.equal((await alice.get('/api/trips/not-an-id')).status, 404)
  })

  test('sharing: a public read-only link that can be turned off', async () => {
    const before = await alice.get(`/api/trips/${tripId}/share`)
    assert.deepEqual(before.body.share, { enabled: false, url: null, canShare: true })
    assert.equal((await bob.get(`/api/trips/${tripId}/share`)).status, 404)
    const on = await alice.post(`/api/trips/${tripId}/share`)
    assert.equal(on.status, 200)
    assert.equal((await alice.get(`/api/trips/${tripId}/share`)).body.share.url, on.body.share.url)
    const shareId = on.body.share.url.split('/share/')[1]
    let pub = await request(app).get(`/api/share/${shareId}`)
    assert.equal(pub.status, 200)
    assert.equal(pub.body.trip.sharedBy, 'Alice')
    assert.equal(pub.body.trip.plan.estimated_cost, 710)
    assert.equal(pub.body.trip.messages, undefined)
    await alice.delete(`/api/trips/${tripId}/share`)
    pub = await request(app).get(`/api/share/${shareId}`)
    assert.equal(pub.status, 404)
    // Sharing again brings back the same link, so links sent earlier work again.
    assert.equal((await alice.post(`/api/trips/${tripId}/share`)).body.share.url, on.body.share.url)
    await alice.delete(`/api/trips/${tripId}/share`)
  })

  test('stats for the profile page', async () => {
    const res = await alice.get('/api/stats')
    assert.equal(res.body.stats.trips, 2)
    assert.equal(res.body.stats.planned, 2)
    assert.equal(res.body.stats.favorites, 1)
    assert.equal(res.body.stats.plansGenerated, 4)
    assert.equal(res.body.stats.destinations, 2)
    assert.deepEqual(res.body.stats.budgetPlanned, [{ currency: 'INR', amount: Math.round(710 * 85) + 300 * 85 }])
    assert.equal(res.body.stats.shared, 0)
    assert.equal(res.body.stats.places.length, 2)
    assert.equal(res.body.stats.activity.length, 6)
    assert.equal(res.body.stats.activity.at(-1).trips, 2)
  })
})

describe('clerk webhook and account deletion', () => {
  const signed = (event) => {
    const payload = JSON.stringify(event)
    const id = `msg_${Math.random().toString(36).slice(2)}`
    const timestamp = new Date()
    const signature = new Webhook(WEBHOOK_SECRET).sign(id, timestamp, payload)
    return request(app)
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('svix-id', id)
      .set('svix-timestamp', String(Math.floor(timestamp.getTime() / 1000)))
      .set('svix-signature', signature)
      .send(payload)
  }

  test('a forged webhook is refused', async () => {
    const res = await request(app).post('/api/webhooks/clerk').set('content-type', 'application/json').send({ type: 'user.deleted', data: { id: 'user_alice' } })
    assert.equal(res.status, 400)
    assert.equal((await alice.get('/api/me')).status, 200)
  })

  test('user.created makes the profile with the sign-up phone number', async () => {
    const res = await signed({ type: 'user.created', data: { id: 'user_carol', first_name: 'Carol', last_name: 'Patel', email_addresses: [{ id: 'e3', email_address: 'carol@example.com' }], primary_email_address_id: 'e3', unsafe_metadata: { phone: '+91 91111 22222' } } })
    assert.equal(res.status, 200)
    const me = await as('user_carol').get('/api/me')
    assert.equal(me.body.user.fullName, 'Carol Patel')
    assert.equal(me.body.user.phone, '+91 91111 22222')
  })

  test('deleting the account removes trips, photo and the Clerk user', async () => {
    const res = await alice.delete('/api/me')
    assert.equal(res.status, 200)
    assert.ok(calls.deleteUser.includes('user_alice'))
    assert.ok(calls.destroyed.includes('worldtour/avatars/user_alice-2'))
    const { Trip } = await import('../src/models/Trip.js')
    assert.equal(await Trip.countDocuments({}), 0)
  })
})
