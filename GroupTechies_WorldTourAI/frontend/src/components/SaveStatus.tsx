import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/account'
import { useSaveStatus } from '../lib/saveStatus'
import { useStore } from '../store'

/** Shown above a finished itinerary for signed-in travelers: whether it is saved to My trips. */
export function SaveStatus() {
  const { signedIn } = useSession()
  const hasPlan = useStore((s) => !!s.plan)
  const { state, message, tripId, retry } = useSaveStatus()
  if (!signedIn || !hasPlan || state === 'idle') return null
  if (state === 'saving') {
    return (
      <div role="status" className="no-print mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 dark:border-white/10 dark:bg-ink-800 dark:text-slate-200">
        <Loader2 size={16} className="animate-spin" /> Saving this itinerary to My trips…
      </div>
    )
  }
  if (state === 'saved') {
    return (
      <div role="status" className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100">
        <Check size={16} /> <span className="flex-1">Saved to My trips.</span>
        <Link to={tripId ? `/trips/${tripId}` : '/history'} className="font-semibold underline">View saved trip</Link>
      </div>
    )
  }
  return (
    <div role="alert" className="no-print mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
      <AlertCircle size={16} /> <span className="min-w-0 flex-1">{message}</span>
      <button onClick={retry} className="font-semibold underline">Try again</button>
    </div>
  )
}
