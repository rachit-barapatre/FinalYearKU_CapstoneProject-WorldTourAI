import { ShieldCheck } from 'lucide-react'
import type { Plan } from '../../lib/types'

const LEVELS: Record<string, string> = {
  provider: 'Real record from a travel data provider',
  live_fares: 'Live fares from a provider',
  live_provider_rates: 'Live rates from a provider',
  real_hotels_estimated_rates: 'Real hotels, estimated rates',
  real_hotels_no_rates: 'Real hotels, no rates',
  ai_suggestion_unconfirmed: 'AI suggestion, not confirmed',
  provider_schedule_estimated_fares: 'Provider schedule, estimated fares',
  estimate: 'Estimate, not a quote',
  not_verified: 'Not verified',
  none: 'None found',
}
const label = (level?: string) => (level ? LEVELS[level] ?? level.replace(/_/g, ' ') : null)

/** How far each part of the plan can be trusted, from the planner's own verification record, plus its warnings and notes. */
export function Verification({ plan }: { plan: Plan }) {
  const v = plan.verification
  const rows: [string, string | null][] = v
    ? [
        ['Attractions', v.attractions?.count ? `${label(v.attractions.level)}${v.attractions.source ? ` (${v.attractions.source})` : ''}` : null],
        ['Hotels', v.hotels ? `${label(v.hotels.level)}${v.hotels.unconfirmed ? `, ${v.hotels.unconfirmed} unconfirmed` : ''}` : null],
        ['Flights', v.flights ? label(v.flights.level) : null],
        ['Train, bus & cab between cities', v.ground_transport ? label(v.ground_transport.level) : null],
        ['Local rides', v.local_transport ? `${v.local_transport.road_routing ?? 0} measured on roads, ${v.local_transport.estimate ?? 0} estimated` : null],
        ['Entry fees', v.entry_fees ? label(v.entry_fees.level) : null],
        ['Opening hours', v.opening_hours ? label(v.opening_hours.level) : null],
      ]
    : []
  const shown = rows.filter((row): row is [string, string] => !!row[1])
  const notes = [...(plan.data_notes ?? []), ...(v?.schedule_checks ?? []), ...(plan.warnings ?? [])].filter((note, i, all) => all.indexOf(note) === i)
  if (!shown.length && !notes.length) return null
  return (
    <details className="no-print group rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-soft dark:border-white/10 dark:bg-ink-800">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <ShieldCheck size={16} className="text-brand-700 dark:text-brand-300" /> Where this plan's information comes from
        <span className="ml-auto text-xs font-medium text-slate-500 group-open:hidden">Show</span>
      </summary>
      {shown.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {shown.map(([name, value]) => (
            <div key={name} className="flex flex-col">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{name}</dt>
              <dd className="text-slate-700 dark:text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
          {notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
    </details>
  )
}
