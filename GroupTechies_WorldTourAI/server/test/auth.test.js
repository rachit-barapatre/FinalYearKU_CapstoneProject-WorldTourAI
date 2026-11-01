// requireUser without a database: the User model's calls are replaced, so this runs anywhere.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import mongoose from 'mongoose'
import { requireUser } from '../src/middleware/auth.js'
import { User } from '../src/models/User.js'

const original = { findOne: User.findOne, findOneAndUpdate: User.findOneAndUpdate, updateOne: User.updateOne }
const identity = { enabled: true, userId: (req) => req.userId ?? null, getUser: async () => ({ firstName: 'Alice' }) }
const run = (req) => new Promise((resolve) => requireUser(identity)(req, {}, (error) => resolve({ error, req })))

beforeEach(() => {
  // connectDatabase() returns at once when mongoose says it is connected.
  Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => 1 })
  User.updateOne = () => ({ catch: () => undefined })
})
afterEach(() => {
  Object.assign(User, original)
  delete mongoose.connection.readyState
})

describe('requireUser', () => {
  test('refuses a request with no signed-in user', async () => {
    const { error } = await run({})
    assert.equal(error.status, 401)
  })

  test('creates the record on first sight', async () => {
    const created = { _id: 'id1', lastActiveAt: new Date() }
    User.findOne = async () => null
    User.findOneAndUpdate = async () => created
    const { error, req } = await run({ userId: 'user_a' })
    assert.equal(error, undefined)
    assert.equal(req.user, created)
  })

  test('two first requests at once: the duplicate-key loser uses the record the winner made', async () => {
    const winner = { _id: 'id2', lastActiveAt: new Date() }
    let reads = 0
    User.findOne = async () => (++reads === 1 ? null : winner)
    User.findOneAndUpdate = async () => {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    }
    const { error, req } = await run({ userId: 'user_a' })
    assert.equal(error, undefined)
    assert.equal(req.user, winner)
  })

  test('other database errors are still reported', async () => {
    User.findOne = async () => null
    User.findOneAndUpdate = async () => {
      throw Object.assign(new Error('network down'), { code: 6 })
    }
    const { error } = await run({ userId: 'user_a' })
    assert.equal(error.message, 'network down')
  })
})
