// What My trips shows in each situation (frontend/src/lib/historyView.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { cacheIsAuthoritative, historySubtitle, historyView } from '../src/lib/historyView.ts'

const base = { loading: false, error: null, count: 0, filtering: false }

describe('My trips states', () => {
  test('loading, empty, no match, list and error are each distinct', () => {
    assert.equal(historyView({ ...base, loading: true }), 'loading')
    assert.equal(historyView(base), 'empty')
    assert.equal(historyView({ ...base, filtering: true }), 'no-match')
    assert.equal(historyView({ ...base, count: 3 }), 'list')
    assert.equal(historyView({ ...base, error: 'Server down' }), 'error')
  })

  test('a failed request is never shown as "no trips yet"', () => {
    assert.equal(historyView({ ...base, error: 'x', filtering: true }), 'error')
    assert.notEqual(historyView({ ...base, error: 'x', loading: false }), 'empty')
  })

  test('trips already on screen stay visible while a refresh is loading or has failed', () => {
    assert.equal(historyView({ ...base, count: 2, loading: true }), 'list')
    assert.equal(historyView({ ...base, count: 2, error: 'x' }), 'list')
  })

  test('the subtitle only promises saved trips when that is the truth', () => {
    assert.match(historySubtitle('list', 1), /^1 trip ·/)
    assert.match(historySubtitle('list', 4), /^4 trips ·/)
    assert.equal(historySubtitle('loading', 0), 'Loading your trips…')
    assert.doesNotMatch(historySubtitle('error', 0), /saved here/)
    assert.match(historySubtitle('empty', 0), /saved here/)
  })

  test('a cached empty list is not trusted, a cached list is', () => {
    assert.equal(cacheIsAuthoritative(undefined), false)
    assert.equal(cacheIsAuthoritative({ trips: [] }), false)
    assert.equal(cacheIsAuthoritative({ trips: [{}] }), true)
  })
})
