import clsx from 'clsx'
import { ArrowLeft, Eye, Layers, MessageSquareText, Pencil, Play, Share2, Star, StickyNote, Trash2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MessageContent } from '../components/MessageContent'
import { PlanReadOnly } from '../components/plan/readOnly'
import { ShareDialog } from '../components/ShareDialog'
import { ConfirmDialog } from '../components/ui'
import { server, type TripSummary } from '../lib/account'
import { invalidate, load as loadCached, peek, setCached } from '../lib/cache'
import { toast } from '../lib/toast'
import { applySelection, type Selection } from '../lib/selection'
import type { ChatMessage, Plan, Session } from '../lib/types'
import { useStore } from '../store'
import { ago, ErrorNote, money, Page, Panel, Skeleton, tripRoute } from './common'
import { RenameDialog } from './HistoryPage'

const PlanView = lazy(() => import('../components/plan/PlanView').then((m) => ({ default: m.PlanView })))

interface Version {
  id: string
  number: number
  prompt: string
  estimatedCost: number | null
  currency: string
  createdAt: string
}

interface TripDetail extends Omit<TripSummary, 'messages'> {
  notes: string
  messages: { role: 'user' | 'assistant'; content: string; at: string }[]
  session: Session | null
  selection: Selection | null
  plan: Plan | null
  versionList: Version[]
  share: { enabled: boolean; url: string | null }
}

export function TripPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const loadTrip = useStore((s) => s.loadTrip)
  const [trip, setTrip] = useState<TripDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ id: string; number: number; plan: Plan } | null>(null)
  const [notes, setNotes] = useState('')
  const [savedNotes, setSavedNotes] = useState('')
  const [sharing, setSharing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const path = `/api/trips/${id}`
  const load = useCallback(() => {
    setError(null)
    const show = ({ trip }: { trip: TripDetail }) => {
      setTrip(trip)
      setNotes(trip.notes)
      setSavedNotes(trip.notes)
      setViewing(null)
    }
    // Shown at once when opened before or prefetched (hovering it in My trips), then refreshed.
    const cached = peek<{ trip: TripDetail }>(path)
    if (cached) show(cached)
    loadCached<{ trip: TripDetail }>(path)
      .then(show)
      .catch((e) => !cached && setError(e.message))
  }, [path])
  useEffect(load, [load])

  /** Applied on screen straight away; undone with a message if the server refuses. */
  const patch = async (body: Record<string, unknown>) => {
    const before = trip
    setTrip((t) => (t ? { ...t, ...body } : t))
    try {
      const { trip: updated } = await server<{ trip: TripSummary }>(path, { method: 'PATCH', body })
      // The summary counts messages; keep the conversation itself.
      const { messages: _count, ...changes } = updated
      void _count
      setTrip((t) => {
        const next = t ? { ...t, ...changes } : t
        if (next) setCached(path, { trip: next })
        return next
      })
      invalidate('/api/trips?')
      invalidate('/api/stats')
    } catch (e) {
      setTrip(before)
      toast.error(e instanceof Error ? `Could not save the change. ${e.message}` : 'Could not save the change.')
      throw e
    }
  }

  const view = async (version: Version) => {
    const { version: full } = await server<{ version: { plan: Plan } }>(`/api/trips/${id}/versions/${version.id}`)
    setViewing({ id: version.id, number: version.number, plan: full.plan })
    window.scrollTo({ top: document.getElementById('trip-plan')?.offsetTop ?? 0, behavior: 'smooth' })
  }

  /** Open this trip in the planner (optionally from an older version) and keep chatting. */
  const resume = (plan: Plan | null, selection: Selection | null) => {
    if (!trip) return
    const messages: ChatMessage[] = trip.messages.map((m) => ({ role: m.role, content: m.content, at: m.at }))
    loadTrip({ id: trip.id, messages, session: trip.session, plan, selection })
    navigate('/')
  }

  const shown = viewing?.plan ?? trip?.plan ?? null
  const shownPlan = useMemo(() => (shown ? applySelection(shown, viewing ? null : trip?.selection ?? null) : null), [shown, viewing, trip?.selection])

  if (error) return <Page title="Trip"><ErrorNote onRetry={load}>{error}</ErrorNote></Page>
  if (!trip) return <Page title="Loading trip…"><Skeleton rows={3} /></Page>

  const latest = trip.versionList.at(-1)
  return (
    <Page
      wide
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{trip.title}</span>
          <button onClick={() => setRenaming(true)} aria-label="Rename trip" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"><Pencil size={17} /></button>
        </span>
      }
      subtitle={`${tripRoute(trip)} · ${trip.startDate ? new Date(`${trip.startDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'flexible dates'} · updated ${ago(trip.updatedAt)}`}
      action={
        <Link to="/history" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"><ArrowLeft size={15} /> All trips</Link>
      }
    >
      <div className="mb-5 flex flex-wrap gap-2">
        <button onClick={() => resume(trip.plan, trip.selection)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 dark:bg-brand-500">
          <Play size={15} /> Continue in planner
        </button>
        <button onClick={() => void patch({ favorite: !trip.favorite }).catch(() => undefined)} aria-pressed={trip.favorite} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-ink-800 dark:text-slate-200">
          <Star size={15} className={trip.favorite ? 'fill-amber-400 text-amber-400' : ''} /> {trip.favorite ? 'Favourite' : 'Add to favourites'}
        </button>
        {trip.versionList.length > 0 && (
          <button onClick={() => setSharing(true)} className={clsx('inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold', trip.share.enabled ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-ink-800 dark:text-slate-200')}>
            <Share2 size={15} /> {trip.share.enabled ? 'Shared · manage link' : 'Share'}
          </button>
        )}
        <button onClick={() => setRemoving(true)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-white/15 dark:bg-ink-800">
          <Trash2 size={15} /> Delete
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5" id="trip-plan">
          {shownPlan ? (
            <>
              {viewing && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
                  <Eye size={16} /> <span className="flex-1">You are looking at plan version {viewing.number} of {trip.versionList.length}.</span>
                  <button onClick={() => resume(viewing.plan, null)} className="font-semibold underline">Continue from this version</button>
                  <button onClick={() => setViewing(null)} className="font-semibold underline">Show latest</button>
                </div>
              )}
              <PlanReadOnly.Provider value={true}>
                <Suspense fallback={<Skeleton rows={2} />}>
                  <PlanView plan={shownPlan} />
                </Suspense>
              </PlanReadOnly.Provider>
            </>
          ) : (
            <Panel title="No itinerary yet" description="The conversation is saved; finish it in the planner to get an itinerary.">
              <button onClick={() => resume(null, null)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">
                <Play size={15} /> Continue the conversation
              </button>
            </Panel>
          )}
        </div>

        <aside className="space-y-5">
          <Panel title={<span className="flex items-center gap-2"><Layers size={16} /> Itinerary versions</span>} description="A new version is saved each time a prompt changes the plan.">
            {trip.versionList.length ? (
              <ol className="space-y-2">
                {[...trip.versionList].reverse().map((v) => {
                  const isShown = viewing ? viewing.id === v.id : v.id === latest?.id
                  return (
                    <li key={v.id} className={clsx('rounded-lg border p-3 text-sm', isShown ? 'border-brand-500 bg-brand-50/60 dark:border-brand-400 dark:bg-brand-500/10' : 'border-slate-200 dark:border-white/10')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">Version {v.number}{v.id === latest?.id ? ' · latest' : ''}</span>
                        <span className="font-semibold tabular-nums">{money(v.estimatedCost, v.currency)}</span>
                      </div>
                      {v.prompt && <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">“{v.prompt}”</p>}
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                        <span>{ago(v.createdAt)}</span>
                        {!isShown && <button onClick={() => void view(v)} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">View</button>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No itinerary has been generated yet.</p>
            )}
          </Panel>

          <Panel title={<span className="flex items-center gap-2"><StickyNote size={16} /> Notes</span>} description="Only you can see these.">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== savedNotes && void patch({ notes }).then(() => setSavedNotes(notes)).catch(() => undefined)}
              rows={4}
              maxLength={4000}
              placeholder="Booking references, packing reminders, ideas…"
              className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/15 dark:bg-ink-900 dark:text-white"
            />
            <p className="mt-1 text-xs text-slate-500">{notes === savedNotes ? 'Saved' : 'Saves when you click outside the box'}</p>
          </Panel>

          <Panel title={<span className="flex items-center gap-2"><MessageSquareText size={16} /> Conversation</span>} description={`${trip.messages.filter((m) => m.role === 'user').length} prompts`}>
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {trip.messages.map((m, i) => (
                <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={clsx('max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed', m.role === 'user' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-800 dark:bg-white/5 dark:text-slate-100')}>
                    {m.role === 'user' ? m.content : <MessageContent text={m.content} />}
                    <div className={clsx('mt-1 text-[10px]', m.role === 'user' ? 'text-white/70' : 'text-slate-400')}>{ago(m.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={removing}
        tone="danger"
        icon={<Trash2 size={20} />}
        title="Delete this trip?"
        body={<>“{trip.title}”, its conversation and all {trip.versionList.length} itinerary versions will be deleted for good.</>}
        confirmLabel="Delete trip"
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false)
          void server(path, { method: 'DELETE' })
            .then(() => {
              if (useStore.getState().tripId === id) useStore.getState().setTripId(null)
              invalidate('/api/trips')
              invalidate('/api/stats')
              toast.success(`“${trip.title}” was deleted.`)
              navigate('/history', { replace: true })
            })
            .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not delete the trip.'))
        }}
      />
      {sharing && (
        <ShareDialog
          tripId={trip.id}
          title={trip.title}
          subtitle={tripRoute(trip)}
          onClose={() => setSharing(false)}
          onChange={(enabled) => setTrip((t) => (t ? { ...t, shared: enabled, share: { ...t.share, enabled } } : t))}
        />
      )}
      {renaming && <RenameDialog title={trip.title} onCancel={() => setRenaming(false)} onSave={(title) => { setRenaming(false); void patch({ title }).catch(() => undefined) }} />}
    </Page>
  )
}
