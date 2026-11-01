// The saved-itinerary library end to end in the browser layer (jsdom): a finished itinerary is saved automatically,
// listed on My trips, reopened exactly as generated without calling the AI, deleted with confirmation, and kept
// apart per user. Clerk is controlled by the test; the accounts server is a fake behind fetch with the real rules.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { clerk, resetClerk } from './clerkMock'
import { createFakeServer } from './fakeServer'
import { richPlan } from './richPlan'

vi.mock('@clerk/clerk-react', async () => {
  const { clerk: state } = await import('./clerkMock')
  const getToken = (options?: { skipCache?: boolean }) => (state.getToken ? state.getToken(options) : Promise.resolve(state.token))
  return {
    useAuth: () => ({ isLoaded: state.isLoaded, isSignedIn: state.isSignedIn, userId: state.userId, getToken }),
    useUser: () => ({ user: { id: state.userId, hasImage: false, imageUrl: '' } }),
    useClerk: () => ({ signOut: async () => undefined }),
  }
})
vi.mock('../src/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api')>()), sendChat: vi.fn(), runPlan: vi.fn() }))
vi.mock('../src/components/plan/PlanView', () => ({
  PlanView: ({ plan }: { plan: any }) => {
    ;(globalThis as any).__shownPlan = plan
    return <div data-testid="plan-view">{plan.trip_summary}</div>
  },
}))

import { Verification } from '../src/components/plan/Verification'
import { SaveStatus } from '../src/components/SaveStatus'
import { ClerkBridge, useAccount } from '../src/lib/account'
import { runPlan, sendChat } from '../src/lib/api'
import { clearServerCache, peek, tripsPath } from '../src/lib/cache'
import { useSaveStatus } from '../src/lib/saveStatus'
import { useTripSync } from '../src/lib/tripSync'
import { HistoryPage } from '../src/pages/HistoryPage'
import { ProfilePage } from '../src/pages/ProfilePage'
import { TripPage } from '../src/pages/TripPage'
import { useStore, WELCOME } from '../src/store'

let api: ReturnType<typeof createFakeServer>
const fresh = () => useStore.setState({ messages: [WELCOME], session: null, summary: null, plan: null, selection: null, tripId: null, draftKey: null, events: [], status: 'idle', error: null, notice: null, ownerId: 'user_alice' })

beforeEach(() => {
  api = createFakeServer()
  globalThis.fetch = vi.fn(api.handler) as unknown as typeof fetch
  resetClerk()
  clearServerCache()
  useAccount.getState().clear()
  useSaveStatus.getState().idle()
  fresh()
  vi.mocked(sendChat).mockReset()
  vi.mocked(runPlan).mockReset()
  ;(globalThis as any).__shownPlan = undefined
})
afterEach(cleanup)

function Harness() {
  useTripSync()
  return <SaveStatus />
}
const planner = () =>
  render(
    <MemoryRouter>
      <ClerkBridge>
        <Harness />
      </ClerkBridge>
    </MemoryRouter>,
  )
/** The traveler asks for a trip and the (mocked) agents produce `plan`: the real store drives the real save. */
async function generate(plan: any = richPlan()) {
  vi.mocked(sendChat).mockResolvedValue({ session: { stage: 'ready' }, reply: 'Planning…', ready: true, changes: [], summary: null })
  vi.mocked(runPlan).mockResolvedValue({ plan, session: { stage: 'planned' } })
  await useStore.getState().send('Plan 3 days in Goa from Ahmedabad for 2 people, budget 60000 INR')
}
const posts = () => api.calls_to('POST', '/api/trips')
const SAVE_WAIT = { timeout: 6000 }

describe('automatic saving of a generated itinerary', () => {
  test('a successful generation is saved once with the complete plan, and the traveler is told', async () => {
    planner()
    await generate()
    expect(await screen.findByText('Saved to My trips.', {}, SAVE_WAIT)).toBeTruthy()
    expect(posts()).toHaveLength(1)
    const sent = posts()[0]
    expect(sent.auth).toBe('Bearer tok-alice')
    expect(sent.body.plan).toEqual(richPlan()) // the whole output, nothing trimmed on the way
    expect(sent.body.clientId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(sent.body.user ?? sent.body.userId ?? sent.body.clerkId).toBeUndefined() // the browser never names the owner
    expect(api.trips).toHaveLength(1)
    expect(api.trips[0].owner).toBe('user_alice')
    expect(useStore.getState().tripId).toBe(api.trips[0].id)
    expect(screen.getByRole('link', { name: 'View saved trip' }).getAttribute('href')).toBe(`/trips/${api.trips[0].id}`)
  })

  test('the status shows "saving" while the request is on its way', async () => {
    planner()
    await generate()
    expect(await screen.findByText(/Saving this itinerary to My trips/, {}, SAVE_WAIT)).toBeTruthy()
    await screen.findByText('Saved to My trips.', {}, SAVE_WAIT)
  })

  test('nothing is saved while the assistant is only chatting, or when generation fails', async () => {
    planner()
    vi.mocked(sendChat).mockResolvedValue({ session: { stage: 'collecting' }, reply: 'Where from?', ready: false, changes: [], summary: null })
    await useStore.getState().send('Plan a trip to Goa')
    vi.mocked(sendChat).mockResolvedValue({ session: { stage: 'ready' }, reply: 'Planning…', ready: true, changes: [], summary: null })
    vi.mocked(runPlan).mockRejectedValue(new Error('The planner took too long to answer. Please try again.'))
    await useStore.getState().send('From Ahmedabad, 3 days, 2 people')
    await new Promise((r) => setTimeout(r, 2200))
    expect(useStore.getState().plan).toBeNull()
    expect(api.calls_to('POST', '/api/trips')).toHaveLength(0)
    expect(api.trips).toHaveLength(0)
    expect(screen.queryByText(/Saved to My trips|Saving this itinerary/)).toBeNull()
  })

  test('a plan with an empty timetable is not saved as a trip', async () => {
    planner()
    await generate({ ...richPlan(), daily_itinerary: [] })
    await new Promise((r) => setTimeout(r, 2200))
    expect(posts()).toHaveLength(0)
  })

  test('a guest generating an itinerary saves nothing to any account', async () => {
    clerk.isSignedIn = false
    clerk.userId = null
    useStore.setState({ ownerId: null })
    planner()
    await generate()
    await new Promise((r) => setTimeout(r, 2200))
    expect(api.calls_to('POST', '/api/trips')).toHaveLength(0)
  })

  test("a draft that belongs to another account is never saved to whoever is signed in now", async () => {
    useStore.setState({ ownerId: 'user_bob' })
    planner()
    await generate()
    await new Promise((r) => setTimeout(r, 2200))
    expect(posts()).toHaveLength(0)
  })

  test('a failed save is never silent: the error says why, and "Try again" saves it without making a duplicate', async () => {
    api.state.failNext = 1
    api.state.failStatus = 413
    planner()
    await generate()
    const alert = await screen.findByRole('alert', {}, SAVE_WAIT)
    expect(alert.textContent).toMatch(/too large/)
    expect(api.trips).toHaveLength(0)
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Saved to My trips.', {}, SAVE_WAIT)).toBeTruthy()
    expect(api.trips).toHaveLength(1)
    expect(posts()).toHaveLength(2)
    expect(posts()[1].body.clientId).toBe(posts()[0].body.clientId) // the same draft key: the server can never make two trips
  })

  test('a refused sign-in is said out loud, not swallowed', async () => {
    api.state.rejectToken = true
    planner()
    await generate()
    const alert = await screen.findByRole('alert', {}, SAVE_WAIT)
    expect(alert.textContent).toMatch(/verify your sign-in/)
    expect(api.trips).toHaveLength(0)
  })

  test('the draft key and trip id are kept across a page reload, so a refresh cannot create a second trip', async () => {
    planner()
    await generate()
    await screen.findByText('Saved to My trips.', {}, SAVE_WAIT)
    const kept = (useStore.persist.getOptions().partialize as (s: unknown) => Record<string, unknown>)(useStore.getState())
    expect(kept.tripId).toBe(api.trips[0].id)
    expect(kept.draftKey).toBe(posts()[0].body.clientId)
    expect(kept.plan).toEqual(richPlan())
  })

  test('after saving, a cached "no trips yet" list is dropped so My trips shows the new trip', async () => {
    const { setCached } = await import('../src/lib/cache')
    setCached(tripsPath(), { trips: [], total: 0, page: 1, pages: 1 })
    planner()
    await generate()
    await screen.findByText('Saved to My trips.', {}, SAVE_WAIT)
    expect(peek(tripsPath())).toBeUndefined()
  })
})

const savedTrip = async (user = 'alice', plan: any = richPlan(), clientId = `draft-${user}-0001`) => {
  const response = await api.handler('http://api.test/api/trips', { method: 'POST', headers: { Authorization: `Bearer tok-${user}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Plan 3 days in Goa from Ahmedabad for 2 people, budget 60000 INR' }], session: { stage: 'planned' }, plan, clientId }) })
  return (await response.json()).trip as { id: string }
}
const openHistory = () =>
  render(
    <MemoryRouter initialEntries={['/history']}>
      <ClerkBridge>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/trips/:id" element={<TripPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </ClerkBridge>
    </MemoryRouter>,
  )
const openTrip = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/trips/${id}`]}>
      <ClerkBridge>
        <Routes>
          <Route path="/trips/:id" element={<TripPage />} />
          <Route path="/history" element={<div>the library</div>} />
        </Routes>
      </ClerkBridge>
    </MemoryRouter>,
  )

describe('My trips library', () => {
  test('a saved trip is listed as a card with destination, origin, dates, duration, travelers, budget and saved date', async () => {
    await savedTrip()
    openHistory()
    const card = (await screen.findByRole('heading', { name: 'Goa · 3 days' }, SAVE_WAIT)).closest('article')!
    const text = card.textContent ?? ''
    expect(text).toContain('Ahmedabad → Goa')
    expect(text).toMatch(/10 Dec.*12 Dec 2026/)
    expect(text).toContain('3 days')
    expect(text).toContain('2 travelers')
    expect(text).toMatch(/Budget.*60,000/)
    expect(text).toMatch(/Saved .*1 Nov 2026/)
    expect(card.querySelector('a')!.getAttribute('href')).toMatch(/^\/trips\/t\d+$/)
  })

  test('the library survives a page refresh and a sign-out/sign-in: it is read from the server again', async () => {
    await savedTrip()
    const first = openHistory()
    await screen.findByRole('heading', { name: 'Goa · 3 days' }, SAVE_WAIT)
    first.unmount()
    clearServerCache() // a reload (or another sign-in) starts with nothing in memory
    useAccount.getState().clear()
    openHistory()
    expect(await screen.findByRole('heading', { name: 'Goa · 3 days' }, SAVE_WAIT)).toBeTruthy()
  })

  test("a user only ever sees their own trips; another user's trip cannot be opened", async () => {
    const mine = await savedTrip('alice')
    const his = await savedTrip('bob', { ...richPlan(), destination: 'Jaipur', trip_summary: 'Jaipur' }, 'draft-bob-000001')
    const view = openHistory()
    await screen.findByRole('heading', { name: 'Goa · 3 days' }, SAVE_WAIT)
    expect(screen.queryByText(/Jaipur/)).toBeNull()
    view.unmount()
    openTrip(his.id) // alice asks for bob's trip id
    expect(await screen.findByText('Trip not found.', {}, SAVE_WAIT)).toBeTruthy()
    expect((globalThis as any).__shownPlan).toBeUndefined()
    expect(mine.id).not.toBe(his.id)
  })

  test('with no trips there is a friendly empty state with a way to plan one', async () => {
    openHistory()
    expect(await screen.findByText('No trips yet', {}, SAVE_WAIT)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Plan a trip/ })).toBeTruthy()
  })

  test('if the library cannot be loaded the traveler sees why, with a retry, not "no trips yet"', async () => {
    api.state.down = true
    openHistory()
    expect(await screen.findByText(/reach WorldTour/, {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByText('No trips yet')).toBeNull()
    api.state.down = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No trips yet', {}, SAVE_WAIT)).toBeTruthy()
  })

  test('delete asks first: cancelling keeps the trip, confirming removes it from the server and the list', async () => {
    const { id } = await savedTrip()
    openHistory()
    await screen.findByRole('heading', { name: 'Goa · 3 days' }, SAVE_WAIT)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete this trip?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.calls_to('DELETE', '/api/trips')).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Goa · 3 days' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete trip' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Goa · 3 days' })).toBeNull())
    expect(api.calls_to('DELETE', `/api/trips/${id}`)).toHaveLength(1)
    expect(api.trips).toHaveLength(0)
  })

  test('a failed delete puts the trip back and says so', async () => {
    await savedTrip()
    openHistory()
    await screen.findByRole('heading', { name: 'Goa · 3 days' }, SAVE_WAIT)
    api.state.down = true
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete trip' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Goa · 3 days' })).toBeTruthy(), SAVE_WAIT)
    expect(api.trips).toHaveLength(1)
  })
})

describe('opening a saved itinerary', () => {
  test('it is fetched from the server and shown exactly as generated, without calling the AI or changing anything', async () => {
    const { id } = await savedTrip()
    const versionsBefore = api.trips[0].versions.length
    api.calls.length = 0
    openTrip(id)
    expect(await screen.findByTestId('plan-view', {}, SAVE_WAIT)).toBeTruthy()
    expect((globalThis as any).__shownPlan).toEqual(richPlan()) // the original output, field for field (incl. verification and data_notes)
    expect(vi.mocked(runPlan)).not.toHaveBeenCalled()
    expect(vi.mocked(sendChat)).not.toHaveBeenCalled()
    expect(api.calls.some((c) => /\/api\/(plan|chat)/.test(c.path))).toBe(false)
    expect(api.calls.filter((c) => c.method !== 'GET')).toHaveLength(0) // read-only: nothing written back
    expect(api.trips).toHaveLength(1)
    expect(api.trips[0].versions).toHaveLength(versionsBefore)
  })

  test('the original request is shown, and the page is not a chat history', async () => {
    const { id } = await savedTrip()
    openTrip(id)
    await screen.findByTestId('plan-view', {}, SAVE_WAIT)
    expect(screen.getByText('Original request')).toBeTruthy()
    expect(screen.getByText(/Plan 3 days in Goa from Ahmedabad/)).toBeTruthy()
    expect(screen.queryByText('Conversation')).toBeNull()
  })

  test('it still opens after a refresh (nothing cached, nothing in the planner)', async () => {
    const { id } = await savedTrip()
    fresh()
    clearServerCache()
    openTrip(id)
    expect(await screen.findByTestId('plan-view', {}, SAVE_WAIT)).toBeTruthy()
  })
})

describe('the sources and verification warnings are shown with the itinerary', () => {
  test('provider labels, estimate indicators and warnings are readable', () => {
    render(<Verification plan={richPlan()} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Real hotels, estimated rates')
    expect(text).toContain('Provider schedule, estimated fares')
    expect(text).toContain('Geoapify (OpenStreetMap)')
    expect(text).toContain('Not verified')
    expect(text).toContain('Flight fares are estimates.')
    expect(text).toContain('Schedule check: day 2 is light')
  })

  test('a plan with no verification record shows nothing rather than inventing reassurance', () => {
    const { container } = render(<Verification plan={{ ...richPlan(), verification: undefined, data_notes: [], warnings: [] }} />)
    expect(container.textContent).toBe('')
  })
})

describe('the profile page', () => {
  const openProfile = () =>
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <ClerkBridge>
          <Routes>
            <Route path="/profile" element={<ProfilePage />} />
          </Routes>
        </ClerkBridge>
      </MemoryRouter>,
    )

  test("the signed-in user's profile loads, with their token on every request, and no sign-in error", async () => {
    openProfile()
    expect(await screen.findByText('alice Traveler', {}, SAVE_WAIT)).toBeTruthy()
    expect(screen.getByText('alice@example.com')).toBeTruthy()
    expect(screen.queryByText(/Please sign in/)).toBeNull()
    const own = api.calls.filter((c) => c.path.startsWith('/api/'))
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((c) => c.auth === 'Bearer tok-alice')).toBe(true)
  })

  test('the very first render with a token that is not ready yet still ends in the profile, not "Please sign in"', async () => {
    let asked = 0
    clerk.getToken = async () => (++asked <= 2 ? null : 'tok-alice')
    openProfile()
    expect(await screen.findByText('alice Traveler', {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByText(/Please sign in/)).toBeNull()
  })

  test('a network failure shows what happened (not a sign-in error), and Try again recovers', async () => {
    api.state.down = true
    openProfile()
    const note = await screen.findByText(/Couldn't load your profile/, {}, { timeout: 8000 })
    expect(note.textContent).toMatch(/reach WorldTour/)
    expect(screen.queryByText(/Please sign in/)).toBeNull()
    api.state.down = false
    fireEvent.click(within(note.parentElement!).getAllByRole('button', { name: 'Try again' })[0])
    expect(await screen.findByText('alice Traveler', {}, SAVE_WAIT)).toBeTruthy()
  })
})
