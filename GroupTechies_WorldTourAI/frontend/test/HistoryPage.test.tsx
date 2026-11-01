// My trips rendered for real (jsdom): the server is a small in-memory stand-in whose answers match the Express routes.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const serverMock = vi.fn()
vi.mock('../src/lib/account', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/account')>()), server: (...args: unknown[]) => serverMock(...args) }))

import { clearServerCache, invalidate } from '../src/lib/cache'
import { HistoryPage } from '../src/pages/HistoryPage'

const trip = (id: string, title: string, extra = {}) => ({
  id, title, firstPrompt: `Plan ${title}`, origin: 'Ahmedabad', destination: title.split(' ')[0], cities: [title.split(' ')[0]],
  durationDays: 3, startDate: '2026-12-10', travelers: 2, estimatedCost: 41500, currency: 'INR', status: 'planned', favorite: false,
  versions: 1, messages: 2, shared: false, lastPlannedAt: '2026-11-01T10:00:00Z', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', ...extra,
})
const list = (trips: unknown[]) => ({ trips, total: trips.length, page: 1, pages: 1 })
const stats = { stats: { trips: 0, planned: 0, favorites: 0 } }

/** A fake accounts server: `saved` is what is in the database for the signed-in user. */
let saved: ReturnType<typeof trip>[]
let failing: boolean
function installServer() {
  serverMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/stats')) return stats
    if (path.startsWith('/api/trips')) {
      if (failing) throw Object.assign(new Error("Couldn't reach WorldTour. Check your connection and try again."), { status: 0 })
      return list(saved)
    }
    throw new Error(`unexpected request ${path}`)
  })
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
const open = () =>
  render(
    <MemoryRouter initialEntries={['/history']}>
      <Where />
      <Routes>
        <Route path="/history" element={<HistoryPage />} />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  saved = []
  failing = false
  clearServerCache()
  serverMock.mockReset()
  installServer()
})
afterEach(cleanup)

describe('My trips page', () => {
  test('shows a loading state while the trips are being fetched', async () => {
    serverMock.mockImplementation(() => new Promise(() => undefined))
    open()
    expect(await screen.findByText('Loading your trips…')).toBeTruthy()
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(screen.queryByText('No trips yet')).toBeNull()
  })

  test('a signed-in user with saved trips sees them', async () => {
    saved = [trip('t1', 'Goa · 3 days'), trip('t2', 'Jaipur · 4 days')]
    open()
    expect(await screen.findByText('Goa · 3 days')).toBeTruthy()
    expect(screen.getByText('Jaipur · 4 days')).toBeTruthy()
    expect(screen.getByText(/2 trips/)).toBeTruthy()
    expect(screen.queryByText('No trips yet')).toBeNull()
  })

  test('a user with no trips gets a friendly empty state with a clear action to plan one', async () => {
    open()
    expect(await screen.findByText('No trips yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /plan a trip/i }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
  })

  test('a failed request shows an understandable error with a retry that works', async () => {
    failing = true
    open()
    expect(await screen.findByText(/Couldn't reach WorldTour/)).toBeTruthy()
    expect(screen.queryByText('No trips yet')).toBeNull()
    expect(screen.queryByText(/saved here/)).toBeNull()
    failing = false
    saved = [trip('t1', 'Goa · 3 days')]
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Goa · 3 days')).toBeTruthy()
    expect(screen.queryByText(/Couldn't reach WorldTour/)).toBeNull()
  })

  test('an empty list left in the cache does not hide a failure (no false "No trips yet")', async () => {
    open()
    await screen.findByText('No trips yet')
    cleanup()
    failing = true // the next visit cannot reach the server; the cache still holds the old empty answer
    open()
    expect(await screen.findByText(/Couldn't reach WorldTour/)).toBeTruthy()
    expect(screen.queryByText('No trips yet')).toBeNull()
  })

  test('trips already shown stay on screen when a refresh fails, with a retry banner', async () => {
    saved = [trip('t1', 'Goa · 3 days')]
    open()
    await screen.findByText('Goa · 3 days')
    cleanup()
    failing = true
    open()
    expect(await screen.findByText(/Couldn't refresh your trips/)).toBeTruthy()
    expect(screen.getByText('Goa · 3 days')).toBeTruthy()
  })

  test('a trip saved after the page was last opened appears the next time it is opened', async () => {
    open()
    await screen.findByText('No trips yet')
    cleanup()
    // The planner saves the new trip and drops the cached lists (lib/tripSync.ts).
    saved = [trip('t9', 'Udaipur · 3 days')]
    invalidate('/api/trips?')
    open()
    expect(await screen.findByText('Udaipur · 3 days')).toBeTruthy()
    expect(screen.queryByText('No trips yet')).toBeNull()
  })

  test('after a full refresh (empty memory) the saved trips are fetched again from the server', async () => {
    saved = [trip('t1', 'Goa · 3 days')]
    open()
    await screen.findByText('Goa · 3 days')
    cleanup()
    clearServerCache() // a reload starts with nothing in memory
    open()
    expect(await screen.findByText('Goa · 3 days')).toBeTruthy()
    expect(serverMock.mock.calls.filter(([p]) => String(p).startsWith('/api/trips')).length).toBeGreaterThanOrEqual(2)
  })

  test('even a stale empty cache shows loading, not "No trips yet", until the server answers', async () => {
    open()
    await screen.findByText('No trips yet')
    cleanup()
    serverMock.mockImplementation((path: string) => (String(path).startsWith('/api/stats') ? Promise.resolve(stats) : new Promise(() => undefined)))
    open()
    expect(await screen.findByText('Loading your trips…')).toBeTruthy()
    expect(screen.queryByText('No trips yet')).toBeNull()
  })
})
