import clsx from 'clsx'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { speechCode, t, type Lang } from '../lib/i18n'

const DAY = 24 * 60 * 60 * 1000

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const sameDay = (a: Date | null, b: Date | null) => !!a && !!b && a.getTime() === b.getTime()
/** "12 Dec 2026" — the form the trip parser reads reliably. */
const forChat = (d: Date) => `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`

/**
 * A calendar for answering "When do you want to travel?": tap a start date, then (optionally) an end date,
 * and the dates are sent as a chat message.
 */
export function DatePicker({
  onSend,
  busy,
  mode,
  lang = 'en',
  onClose,
}: {
  onSend: (text: string) => void
  busy: boolean
  /** "ask": the assistant is asking for dates; "change": the plan exists and the traveler wants new dates. */
  mode: 'ask' | 'change'
  lang?: Lang
  onClose?: () => void
}) {
  const today = startOfDay(new Date())
  // Names of months and weekdays in the chat language; dates sent to the planner stay in English.
  const locale = speechCode(lang)
  const pretty = (d: Date) => d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' }))
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [start, setStart] = useState<Date | null>(null)
  const [end, setEnd] = useState<Date | null>(null)

  const firstWeekday = (month.getDay() + 6) % 7 // Monday first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  const atFirstMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()
  const days = start && end ? Math.round((end.getTime() - start.getTime()) / DAY) + 1 : null

  const pick = (day: Date) => {
    if (!start || end || day < start) {
      setStart(day)
      setEnd(null)
    } else if (sameDay(day, start)) {
      setEnd(null)
    } else {
      setEnd(day)
    }
  }

  const send = () => {
    if (!start) return
    const dates = end ? `${forChat(start)} to ${forChat(end)}` : forChat(start)
    onSend(mode === 'change' ? `travel dates ${dates}` : dates)
  }

  return (
    <div className="animate-fade-up rounded-xl border border-slate-200 bg-white p-3 shadow-soft dark:border-white/10 dark:bg-ink-800" role="group" aria-label="Choose travel dates">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-white">
          <CalendarDays size={15} className="text-brand-700 dark:text-brand-300" />
          {mode === 'change' ? t(lang, 'calendarChange') : t(lang, 'calendarAsk')}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close calendar" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10">
            <X size={15} />
          </button>
        )}
      </div>

      <div className="mb-1 flex items-center justify-between">
        <button
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          disabled={atFirstMonth}
          aria-label="Previous month"
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-bold text-slate-900 dark:text-white" aria-live="polite">
          {month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
        </div>
        <button
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label="Next month"
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-slate-400">
        {weekdays.map((d, i) => <div key={i} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, index) => {
          if (!day) return <div key={`blank-${index}`} />
          const past = day < today
          const isStart = sameDay(day, start)
          const isEnd = sameDay(day, end)
          const inRange = !!start && !!end && day > start && day < end
          return (
            <button
              key={day.getTime()}
              disabled={past || busy}
              onClick={() => pick(day)}
              aria-pressed={isStart || isEnd}
              aria-label={day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              className={clsx(
                'h-9 text-sm tabular-nums transition',
                inRange && 'bg-brand-50 text-brand-900 dark:bg-brand-500/15 dark:text-brand-100',
                (isStart || isEnd) && 'rounded-lg bg-brand-700 font-bold text-white dark:bg-brand-500',
                isStart && end && 'rounded-r-none',
                isEnd && 'rounded-l-none',
                !isStart && !isEnd && !inRange && !past && 'rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10',
                past && 'cursor-not-allowed text-slate-300 dark:text-slate-600',
                sameDay(day, today) && !isStart && !isEnd && 'font-bold underline decoration-coral-500 decoration-2 underline-offset-4',
              )}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-white/10">
        <div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
          {start ? (
            <>
              <span className="font-semibold text-slate-900 dark:text-white">{pretty(start)}</span>
              {end ? (
                <>
                  {' → '}
                  <span className="font-semibold text-slate-900 dark:text-white">{pretty(end)}</span> · {t(lang, 'days', { n: days ?? 0 })}
                </>
              ) : (
                <span className="text-slate-400"> · {t(lang, 'tapReturn')}</span>
              )}
            </>
          ) : (
            t(lang, 'tapStart')
          )}
        </div>
        <div className="flex gap-1.5">
          {start && (
            <button onClick={() => { setStart(null); setEnd(null) }} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
              {t(lang, 'clear')}
            </button>
          )}
          <button
            onClick={send}
            disabled={!start || busy}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-800 disabled:opacity-40 dark:bg-brand-500 dark:hover:bg-brand-400"
          >
            {end ? t(lang, 'useDates') : t(lang, 'useDate')}
          </button>
        </div>
      </div>
    </div>
  )
}
