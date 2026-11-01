import clsx from 'clsx'
import { Archive, ArchiveRestore, Heart, Pencil, Plane, Plus, Repeat, Search, Share2, Sparkles, Star, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Select } from '../components/Select'
import { ShareDialog } from '../components/ShareDialog'
import { ConfirmDialog, CountUp } from '../components/ui'
import { server, type TripSummary } from '../lib/account'
import { invalidate, load as loadCached, peek, setCached, tripsPath, useServerData } from '../lib/cache'
import { toast } from '../lib/toast'
import { useStore } from '../store'
import { ErrorNote, IconButton, Page, TripCard, tripRoute } from './common'

type Filter = 'active' | 'favorite' | 'planned' | 'planning' | 'archived'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'active', label: 'All' },
  { id: 'favorite', label: 'Favourites' },
  { id: 'planned', label: 'Planned' },
  { id: 'planning', label: 'Not planned yet' },
  { id: 'archived', label: 'Archived' },
]

const IDEAS = ['Goa from Mumbai, 4 days, 2 people, beaches', 'Jaipur and Udaipur for a week, heritage and food', 'Dubai for 5 days with family, mid-range budget']

interface ListResponse {
  trips: TripSummary[]
  total: number
  page: number
  pages: number
}

export function HistoryPage() {
  const [trips, setTrips] = useState<TripSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('active')
  const [sort, setSort] = useState<'recent' | 'oldest' | 'budget' | 'name'>('recent')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<TripSummary | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [sharing, setSharing] = useState<TripSummary | null>(null)
  const navigate = useNavigate()
  const reset = useStore((s) => s.reset)
  const stats = useServerData<{ stats: { trips: number; planned: number; favorites: number; shared?: number } }>('/api/stats').data?.stats
  const firstPage = tripsPath({ sort, page: 1, search: query, filter })
  const shownPath = useRef(firstPage)

  // Search as you type, after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const apply = (data: ListResponse, append: boolean) => {
    setTrips((current) => (append ? [...current, ...data.trips] : data.trips))
    setTotal(data.total)
    setPage(data.page)
    setPages(data.pages)
  }

  const load = useCallback(
    async (nextPage: number) => {
      const path = nextPage === 1 ? firstPage : tripsPath({ sort, page: nextPage, search: query, filter })
      if (nextPage === 1) shownPath.current = path
      // The first page shows straight from the cache (opened before or prefetched from the menu), then refreshes.
      const cached = nextPage === 1 ? peek<ListResponse>(path) : undefined
      if (cached) apply(cached, false)
      setLoading(!cached)
      setError(null)
      try {
        const data = await loadCached<ListResponse>(path)
        if (nextPage > 1 || shownPath.current === path) apply(data, nextPage > 1)
      } catch (e) {
        if (!cached) setError(e instanceof Error ? e.message : 'Could not load your trips.')
      } finally {
        setLoading(false)
      }
    },
    [firstPage, query, filter, sort],
  )
  useEffect(() => void load(1), [load])

  /** Change the list now; undo it if the server says no. */
  const optimistic = async (change: (list: TripSummary[]) => TripSummary[], request: () => Promise<unknown>, failure: string) => {
    const before = trips
    const after = change(before)
    setTrips(after)
    setCached<ListResponse | undefined>(shownPath.current, (c) => (c ? { ...c, trips: after } : c))
    try {
      await request()
      invalidate('/api/stats')
      invalidate('/api/trips?')
      setCached<ListResponse | undefined>(shownPath.current, (c) => (c ? { ...c, trips: after } : c))
      return true
    } catch (e) {
      setTrips(before)
      setCached<ListResponse | undefined>(shownPath.current, (c) => (c ? { ...c, trips: before } : c))
      toast.error(e instanceof Error ? `${failure} ${e.message}` : failure)
      return false
    }
  }

  const keepsShowing = (t: TripSummary) => (filter === 'archived' ? t.status === 'archived' : t.status !== 'archived') && (filter !== 'favorite' || t.favorite)

  const patch = (trip: TripSummary, body: Partial<TripSummary>, failure = 'Could not save the change.') =>
    optimistic(
      (list) => list.map((t) => (t.id === trip.id ? { ...t, ...body } : t)).filter(keepsShowing),
      () => server(`/api/trips/${trip.id}`, { method: 'PATCH', body }),
      failure,
    )

  const planAgain = (trip: TripSummary) => {
    reset()
    navigate(`/?q=${encodeURIComponent(trip.firstPrompt)}`)
  }

  const counts: { id: Filter; label: string; value?: number; icon: ReactNode }[] = [
    { id: 'active', label: 'Trips', value: stats?.trips, icon: <Plane size={15} /> },
    { id: 'planned', label: 'Planned', value: stats?.planned, icon: <Sparkles size={15} /> },
    { id: 'favorite', label: 'Favourites', value: stats?.favorites, icon: <Heart size={15} /> },
  ]

  return (
    <Page
      wide
      title="My trips"
      subtitle={total ? `${total} trip${total > 1 ? 's' : ''} · every prompt and itinerary is saved automatically` : 'Every trip you plan while signed in is saved here.'}
      action={
        <button onClick={() => { reset(); navigate('/') }} className="btn-shine inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-brand-800 dark:bg-brand-500">
          <Plus size={16} /> New trip
        </button>
      }
    >
      <div className="stagger mb-5 grid grid-cols-3 gap-2 sm:gap-3">
        {counts.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={clsx(
              'lift flex items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-soft sm:p-4 dark:bg-ink-800',
              filter === c.id ? 'border-brand-500 ring-2 ring-brand-500/15 dark:border-brand-400' : 'border-slate-200 dark:border-white/10',
            )}
          >
            <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 sm:grid dark:bg-brand-500/15 dark:text-brand-200">{c.icon}</span>
            <span className="min-w-0">
              <span className="block text-xl font-extrabold tabular-nums text-slate-900 sm:text-2xl dark:text-white">{c.value == null ? '–' : <CountUp value={c.value} />}</span>
              <span className="block truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 dark:border-white/15 dark:bg-ink-800">
          <Search size={17} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by destination, city or what you asked…" aria-label="Search trips" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none dark:text-white" />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"><X size={15} /></button>}
        </label>
        <div className="md:w-56">
          <Select
            value={sort}
            onChange={setSort}
            label="Sort trips"
            className="text-sm dark:bg-ink-800"
            options={[
              { value: 'recent', label: 'Recently updated' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'budget', label: 'Highest budget' },
              { value: 'name', label: 'Name A–Z' },
            ]}
          />
        </div>
      </div>
      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={clsx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition active:scale-95', filter === f.id ? 'bg-brand-700 text-white shadow-sm dark:bg-brand-500' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-300 dark:border-white/10 dark:bg-ink-800 dark:text-slate-300')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorNote onRetry={() => void load(1)}>{error}</ErrorNote>
      ) : loading && !trips.length ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-ink-800">
              <span className="skeleton h-16 w-16 rounded-lg" />
              <span className="flex-1 space-y-2"><span className="skeleton block h-4 w-1/3 rounded" /><span className="skeleton block h-3 w-1/2 rounded" /></span>
            </div>
          ))}
        </div>
      ) : !trips.length ? (
        <div className="animate-fade-up rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-12 dark:border-white/15 dark:bg-ink-800">
          <img src="/logo-globe.svg" alt="" width={72} height={72} className="float-slow mx-auto" />
          <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">{query || filter !== 'active' ? 'No trips match' : 'No trips yet'}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600 dark:text-slate-300">{query || filter !== 'active' ? 'Try another search or filter.' : 'Plan a trip and it appears here with every prompt and itinerary. Try one of these:'}</p>
          {!query && filter === 'active' && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {IDEAS.map((idea) => (
                <button key={idea} onClick={() => { reset(); navigate(`/?q=${encodeURIComponent(idea)}`) }} className="rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-sm font-medium text-slate-700 transition hover:-translate-y-px hover:border-brand-300 hover:bg-brand-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                  {idea}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="stagger space-y-3">
            {trips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                actions={
                  <>
                    <IconButton label={trip.favorite ? 'Remove from favourites' : 'Add to favourites'} pressed={trip.favorite} onClick={() => void patch(trip, { favorite: !trip.favorite })}>
                      <Star size={16} className={clsx('transition-transform', trip.favorite && 'scale-110 fill-amber-400 text-amber-400')} />
                    </IconButton>
                    <IconButton label="Rename" onClick={() => setRenaming({ id: trip.id, title: trip.title })}><Pencil size={15} /></IconButton>
                    {trip.versions > 0 && (
                      <IconButton label={trip.shared ? 'Shared · manage link' : 'Share'} onClick={() => setSharing(trip)}>
                        <Share2 size={15} className={trip.shared ? 'text-emerald-600 dark:text-emerald-400' : ''} />
                      </IconButton>
                    )}
                    {trip.firstPrompt && <IconButton label="Plan again from this prompt" onClick={() => planAgain(trip)}><Repeat size={15} /></IconButton>}
                    <IconButton
                      label={trip.status === 'archived' ? 'Restore' : 'Archive'}
                      onClick={() => {
                        const restoring = trip.status === 'archived'
                        void patch(trip, { status: restoring ? 'planned' : 'archived' }).then((ok) => ok && toast.info(restoring ? 'Trip restored.' : 'Trip archived. Find it under Archived.'))
                      }}
                    >
                      {trip.status === 'archived' ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    </IconButton>
                    <IconButton label="Delete" tone="danger" onClick={() => setRemoving(trip)}><Trash2 size={15} /></IconButton>
                  </>
                }
              />
            ))}
          </div>
          {page < pages && (
            <button onClick={() => void load(page + 1)} disabled={loading} className="mx-auto mt-2 block rounded-lg border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/15 dark:text-slate-200">
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        tone="danger"
        icon={<Trash2 size={20} />}
        title="Delete this trip?"
        body={<>“{removing?.title}”, its conversation and all {removing?.versions ?? 0} itinerary versions will be deleted for good.</>}
        confirmLabel="Delete trip"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const trip = removing!
          setRemoving(null)
          setTotal((n) => n - 1)
          if (useStore.getState().tripId === trip.id) useStore.getState().setTripId(null)
          void optimistic(
            (list) => list.filter((t) => t.id !== trip.id),
            () => server(`/api/trips/${trip.id}`, { method: 'DELETE' }).then(() => toast.success(`“${trip.title}” was deleted.`)),
            'Could not delete the trip.',
          )
        }}
      />
      {sharing && (
        <ShareDialog
          tripId={sharing.id}
          title={sharing.title}
          subtitle={tripRoute(sharing)}
          onClose={() => setSharing(null)}
          onChange={(shared) => {
            setTrips((list) => list.map((t) => (t.id === sharing.id ? { ...t, shared } : t)))
            invalidate('/api/stats')
          }}
        />
      )}
      {renaming && (
        <RenameDialog
          title={renaming.title}
          onCancel={() => setRenaming(null)}
          onSave={(title) => {
            const trip = trips.find((t) => t.id === renaming.id)!
            setRenaming(null)
            void patch(trip, { title }, 'Could not rename the trip.')
          }}
        />
      )}
    </Page>
  )
}

export function RenameDialog({ title, onSave, onCancel }: { title: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(title)
  return (
    <ConfirmDialog
      open
      icon={<Pencil size={20} />}
      title="Rename trip"
      body={
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={120}
          aria-label="Trip name"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && onSave(value.trim())}
          className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/15 dark:bg-ink-900 dark:text-white"
        />
      }
      confirmLabel="Save"
      focusConfirm={false}
      onCancel={onCancel}
      onConfirm={() => value.trim() && onSave(value.trim())}
    />
  )
}
