// The health endpoint needs no database and no sign-in. Run on its own: node --test test/health.test.js
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'

const HANDSHAKE = 'https://example.clerk.accounts.dev/v1/client/handshake'

/** A stand-in for Clerk's middleware that, like the real one in development, redirects browser page visits to its handshake. */
function appWithClerkLikeMiddleware() {
  const seen = []
  const identity = {
    enabled: true,
    middleware: (req, res, next) => {
      seen.push(req.path)
      if (req.get('sec-fetch-dest') === 'document') return res.redirect(307, HANDSHAKE)
      next()
    },
    userId: () => null,
    getUser: async () => null,
    updateUser: async () => null,
    deleteUser: async () => null,
  }
  return { app: createApp({ identity, photos: { enabled: false } }), seen }
}

describe('health endpoint', () => {
  test('answers when opened in a browser, without going through the sign-in middleware', async () => {
    const { app, seen } = appWithClerkLikeMiddleware()
    const res = await request(app).get('/api/health').set('Sec-Fetch-Dest', 'document').set('Accept', 'text/html')
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'ok')
    assert.deepEqual(seen, [])
  })

  test('reports configuration without exposing any keys', async () => {
    const { app } = appWithClerkLikeMiddleware()
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body).sort(), ['allowedOrigins', 'clerk', 'clerkWebhook', 'cloudinary', 'database', 'status'])
  })

  test('the root page points to it', async () => {
    const { app } = appWithClerkLikeMiddleware()
    const res = await request(app).get('/').set('Sec-Fetch-Dest', 'document')
    assert.equal(res.status, 200)
    assert.equal(res.body.health, '/api/health')
  })

  test('account routes still sit behind sign-in', async () => {
    const { app, seen } = appWithClerkLikeMiddleware()
    const visit = await request(app).get('/api/me').set('Sec-Fetch-Dest', 'document')
    assert.equal(visit.status, 307)
    assert.deepEqual(seen, ['/api/me'])
    const api = await request(app).get('/api/trips')
    assert.equal(api.status, 401)
  })

  test('an unknown path is still a 404', async () => {
    const { app } = appWithClerkLikeMiddleware()
    const res = await request(app).get('/api/nope')
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'Not found.')
  })
})
