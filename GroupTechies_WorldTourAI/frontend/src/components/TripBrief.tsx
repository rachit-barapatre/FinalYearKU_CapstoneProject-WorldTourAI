import clsx from 'clsx'
import { CalendarDays, CheckCircle2, Circle, Compass, Heart, MapPin, Navigation, ShieldCheck, Users, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatLocal, prettyDate } from '../lib/money'
import { useStore } from '../store'
import { Card } from './ui'

interface Row {
  icon: ReactNode
  label: string
  value: string | null
  optional?: boolean
}

/** Right-hand panel while the chat is still collecting details: fills in live as answers arrive. */
export function TripBrief() {
  const summary = useStore((s) => s.summary)
  const stage = useStore((s) => s.session?.stage)
  const s = summary
  const destination = s?.destination
    ? `${s.destination}${s.cities.length > 1 ? ` (${s.cities.join(', ')})` : ''}`
    : null
  const dates = s?.start_date
    ? `${prettyDate(s.start_date)}${s.end_date && s.end_date !== s.start_date ? ` – ${prettyDate(s.end_date, true)}` : ''}`
    : null
  const rows: Row[] = [
    { icon: <Navigation size={16} />, label: 'From', value: s?.origin ?? null },
    { icon: <MapPin size={16} />, label: 'To', value: destination },
    { icon: <CalendarDays size={16} />, label: 'Duration', value: s?.duration_days ? `${s.duration_days} days` : null },
    { icon: <Wallet size={16} />, label: 'Budget', value: s?.budget != null ? `${formatLocal(s.budget, s.currency)}${s.budget_scope === 'per_person' ? ' per person' : ''}` : null },
    { icon: <Users size={16} />, label: 'Travelers', value: s?.travelers ? `${s.travelers} ${s.travelers === 1 ? 'person' : 'people'}` : null },
    { icon: <CalendarDays size={16} />, label: 'Dates', value: dates, optional: true },
    {
      icon: <Heart size={16} />,
      label: 'Interests & pace',
      value: s && (s.preferences.length || s.pace) ? [s.preferences.join(', '), s.pace && `${s.pace} pace`].filter(Boolean).join(' · ') : null,
      optional: true,
    },
  ]
  const required = rows.filter((row) => !row.optional)
  const filled = required.filter((row) => row.value).length

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-up py-2 lg:py-8">
      <div className="mb-6">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-coral-600 dark:text-coral-400">Trip brief</div>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-white">
          {destination ? `Your trip to ${s?.destination}` : 'Tell me about your trip'}
        </h1>
        <p className="mt-1.5 text-slate-600 dark:text-slate-400">
          {stage === 'feasibility'
            ? 'Something about the trip needs your decision — check the chat.'
            : 'Answer in the chat; this brief fills in as I understand each detail.'}
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-white/10">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Essentials</span>
          <span className="text-xs font-semibold text-slate-500">{filled} of {required.length}</span>
        </div>
        <div className="h-1 bg-slate-100 dark:bg-white/5">
          <div className="h-full bg-brand-700 dark:bg-brand-400 transition-all duration-500" style={{ width: `${(filled / required.length) * 100}%` }} />
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-3 px-5 py-3">
              <span className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', row.value ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' : 'bg-slate-100 text-slate-400 dark:bg-white/5')}>
                {row.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {row.label}
                  {row.optional && <span className="ml-1 text-slate-400">(optional)</span>}
                </div>
                <div className={clsx('truncate text-sm font-semibold first-letter:uppercase', row.value ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>
                  {row.value ?? (row.optional ? 'Flexible' : 'Waiting for your answer')}
                </div>
              </div>
              {row.value ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" /> : <Circle size={18} className="shrink-0 text-slate-300 dark:text-slate-600" />}
            </li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: <ShieldCheck size={18} />, title: 'Reality check', text: 'Too far for the days or under budget? I’ll say so first.' },
          { icon: <Compass size={18} />, title: 'Nine agents', text: 'Fares, trains, hotels, weather and places, in parallel.' },
          { icon: <CalendarDays size={18} />, title: 'Full timetable', text: 'Every transfer, visit and meal, with times and costs.' },
        ].map((item) => (
          <div key={item.title} className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-ink-800">
            <span className="text-brand-600 dark:text-brand-300">{item.icon}</span>
            <div className="mt-2 text-sm font-bold text-slate-900 dark:text-white">{item.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{item.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
