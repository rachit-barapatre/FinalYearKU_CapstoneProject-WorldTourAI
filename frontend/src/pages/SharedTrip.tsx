import { Sparkles } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PlanReadOnly } from '../components/plan/readOnly'
import { SERVER_URL } from '../lib/account'
import { applySelection, type Selection } from '../lib/selection'
import type { Plan } from '../lib/types'
import { ErrorNote, Skeleton } from './common'

const PlanView = lazy(() => import('../components/plan/PlanView').then((m) => ({ default: m.PlanView })))

interface Shared {
  title: string
  sharedBy: string
  sharedByPhoto: string
  plan: Plan
  selection: Selection | null
  plannedAt: string
}

/** A trip someone shared: read-only, no sign-in needed. */
export function SharedTrip() {
  const { shareId = '' } = useParams()
  const [trip, setTrip] = useState<Shared | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!SERVER_URL) return setError('Sharing is not set up on this site.')
    fetch(`${SERVER_URL}/api/share/${encodeURIComponent(shareId)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || 'This shared trip could not be opened.')
        setTrip(data.trip)
        document.title = `${data.trip.title} — shared on WorldTour`
      })
      .catch((e) => setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : "Couldn't reach WorldTour. Check your connection."))
  }, [shareId])

  const plan = useMemo(() => (trip ? applySelection(trip.plan, trip.selection) : null), [trip])

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-6 sm:px-6">
      {error ? (
        <div className="mx-auto max-w-lg py-16 text-center">
          <img src="/logo-globe.svg" alt="" width={64} height={64} className="mx-auto" />
          <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
          <Link to="/" className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white">Plan your own trip</Link>
        </div>
      ) : !trip || !plan ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-400/30 dark:bg-brand-500/10">
            {trip.sharedByPhoto ? (
              <img src={trip.sharedByPhoto} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-700 font-bold text-white">{trip.sharedBy[0]}</span>
            )}
            <div className="min-w-0 flex-1 text-sm text-brand-900 dark:text-brand-100">
              <b>{trip.sharedBy}</b> shared this trip plan with you
              <span className="block text-xs text-brand-800/70 dark:text-brand-100/70">Planned {new Date(trip.plannedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · prices are estimates from that day</span>
            </div>
            <Link to={`/?q=${encodeURIComponent(`${plan.duration.days ?? 4} days in ${plan.destination ?? ''}${plan.origin ? ` from ${plan.origin}` : ''}`)}`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 dark:bg-brand-500">
              <Sparkles size={15} /> Plan a trip like this
            </Link>
          </div>
          <PlanReadOnly.Provider value={true}>
            <Suspense fallback={<Skeleton rows={3} />}>
              <PlanView plan={plan} />
            </Suspense>
          </PlanReadOnly.Provider>
        </>
      )}
    </main>
  )
}
