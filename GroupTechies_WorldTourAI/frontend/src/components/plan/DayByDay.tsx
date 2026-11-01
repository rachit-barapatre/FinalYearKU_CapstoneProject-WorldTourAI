import clsx from 'clsx'
import { BedDouble, Bus, Car, Coffee, Footprints, Info, Landmark, MapPin, Moon, Plane, Sun, Sunrise, TrainFront, Utensils } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { fillMoney, formatMoney, hhmm, prettyDate, type Display } from '../../lib/money'
import type { Activity, Plan } from '../../lib/types'
import { Card } from '../ui'
import { DayMap } from './DayMap'
import { weatherEmoji } from '../../lib/weather'

export function DayByDay({ plan, display }: { plan: Plan; display: Display }) {
  const [selected, setSelected] = useState(0)
  const days = plan.daily_itinerary
  if (!days.length) return <Card className="p-6 text-sm text-slate-500">No itinerary was produced.</Card>
  const day = days[Math.min(selected, days.length - 1)]
  const weather = plan.weather_information.days.find((w) => w.day === day.day)

  return (
    <div className="space-y-3">
      <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {days.map((d, index) => (
          <button
            key={d.day}
            onClick={() => setSelected(index)}
            className={clsx(
              'shrink-0 rounded-xl border px-3 py-2 text-left transition',
              index === selected ? 'border-brand-700 bg-brand-700 text-white dark:border-brand-500 dark:bg-brand-500' : 'border-slate-200 bg-white hover:border-brand-300 dark:border-white/10 dark:bg-ink-800',
            )}
          >
            <div className="text-xs font-semibold opacity-80">Day {d.day}</div>
            <div className="text-sm font-medium">{d.date ? prettyDate(d.date) : d.city}</div>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 p-4 dark:border-white/10">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{day.title}</h2>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              {day.date && <span>{prettyDate(day.date, true)}</span>}
              <span className="inline-flex items-center gap-1"><MapPin size={13} /> {day.city}</span>
              {day.stay_name && day.stay_name !== '—' && <span className="inline-flex items-center gap-1"><BedDouble size={13} /> {day.stay_name}</span>}
            </div>
          </div>
          {weather && (
            <div className="rounded-xl bg-slate-50 px-3 py-1.5 text-sm dark:bg-white/5">
              {weatherEmoji(weather.condition)} {Math.round(weather.temp_max_c ?? 0)}°/{Math.round(weather.temp_min_c ?? 0)}° · 💧{weather.precipitation_probability ?? 0}%
            </div>
          )}
        </div>

        {day.notes?.map((note) => (
          <div key={note} className="flex gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
            <Info size={15} className="mt-0.5 shrink-0" /> {note}
          </div>
        ))}
        <div className="grid gap-0 lg:grid-cols-5">
          <div className="space-y-4 p-4 lg:col-span-3">
            <div className="space-y-2">
              <Part icon={<Sunrise size={15} />} label="Morning" text={fillMoney(day.morning, display)} />
              <Part icon={<Sun size={15} />} label="Midday" text={fillMoney(day.midday, display)} />
              <Part icon={<Moon size={15} />} label="Evening" text={fillMoney(day.evening, display)} />
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Timetable</div>
              <ol className="relative space-y-0.5 border-l-2 border-slate-200 pl-4 dark:border-white/10">
                {day.activities.map((activity) => (
                  <TimelineItem key={activity.activity_id} activity={activity} display={display} />
                ))}
              </ol>
              {!!day.local_transport_usd && (
                <div className="mt-3 text-sm text-slate-500">
                  Local transport today: <span className="font-semibold text-slate-700 dark:text-slate-200">{formatMoney(day.local_transport_usd, display, true)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="h-[320px] p-4 lg:col-span-2 lg:h-auto lg:min-h-[420px] lg:pl-0">
            <DayMap key={day.day} day={day} />
          </div>
        </div>
      </Card>
      {plan.daily_spend?.detail && <p className="px-1 text-xs text-slate-500">{fillMoney(plan.daily_spend.detail, display)}</p>}
    </div>
  )
}

function Part({ icon, label, text }: { icon: ReactNode; label: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
      <span className="mt-0.5 text-coral-500">{icon}</span>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{text}</p>
      </div>
    </div>
  )
}

function TimelineItem({ activity, display }: { activity: Activity; display: Display }) {
  const transfer = activity.category === 'transfer'
  const icon = iconFor(activity)
  return (
    <li className={clsx('relative py-1.5', transfer && 'opacity-80')}>
      <span
        className={clsx(
          'absolute -left-[27px] top-2 grid h-5 w-5 place-items-center rounded-full ring-4 ring-white dark:ring-ink-800',
          transfer ? 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300' : activity.category === 'free' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-brand-700 text-white dark:bg-brand-500',
        )}
      >
        {icon}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-slate-500">{hhmm(activity.start_minute)}–{hhmm(activity.end_minute)}</span>
        <span className={clsx('text-sm', transfer ? 'text-slate-600 dark:text-slate-300' : 'font-medium text-slate-900 dark:text-white')}>{activity.name}</span>
      </div>
      {activity.detail && <div className="text-xs text-slate-500 dark:text-slate-400">{fillMoney(activity.detail, display)}</div>}
    </li>
  )
}

function iconFor(activity: Activity): ReactNode {
  const size = 11
  switch (activity.mode) {
    case 'flight': return <Plane size={size} />
    case 'train': return <TrainFront size={size} />
    case 'bus': return <Bus size={size} />
    case 'walk': return <Footprints size={size} />
    case 'cab': return <Car size={size} />
  }
  if (activity.category === 'meal' || activity.category === 'food') return <Utensils size={size} />
  if (activity.category === 'stay') return <BedDouble size={size} />
  if (activity.category === 'free') return <Coffee size={size} />
  if (activity.category === 'travel') return <Plane size={size} />
  return <Landmark size={size} />
}
