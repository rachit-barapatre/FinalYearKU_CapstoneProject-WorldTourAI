// What My trips shows, decided from plain facts so every state can be unit-tested (frontend/test/history.test.mjs).

export type HistoryView = 'loading' | 'error' | 'empty' | 'no-match' | 'list'

export function historyView(input: { loading: boolean; error: string | null; count: number; filtering: boolean }): HistoryView {
  if (input.count > 0) return 'list' // trips already known stay visible; a failed refresh is a banner on top, not a blank page
  if (input.error) return 'error' // never show "no trips yet" when the truth is "we could not ask"
  if (input.loading) return 'loading'
  return input.filtering ? 'no-match' : 'empty'
}

export function historySubtitle(view: HistoryView, total: number): string {
  if (view === 'list' && total) return `${total} trip${total > 1 ? 's' : ''} · every itinerary you generate is saved automatically`
  if (view === 'loading') return 'Loading your trips…'
  if (view === 'error') return "We couldn't load your trips."
  return 'Every trip you plan while signed in is saved here.'
}

/** A cached empty list proves nothing (a trip may have been saved since), so it never replaces the loading state. */
export function cacheIsAuthoritative(cached: { trips: unknown[] } | undefined): boolean {
  return !!cached && cached.trips.length > 0
}
