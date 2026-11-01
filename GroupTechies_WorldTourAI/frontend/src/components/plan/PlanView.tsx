import clsx from 'clsx'
import { CalendarDays, Check, Copy, FileDown, LayoutDashboard, ListChecks, Luggage, PieChart, PiggyBank, RotateCcw, Share2, SlidersHorizontal, Users, Wallet } from 'lucide-react'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useSession } from '../../lib/account'
import { planOutline } from '../../lib/calendar'
import { useWikiImage } from '../../lib/images'
import { formatLocal, formatMoney, prettyDate, type Display } from '../../lib/money'
import type { Plan } from '../../lib/types'
import { useStore } from '../../store'
import { usePlanAction, usePlanReadOnly } from './readOnly'
import { ShareDialog } from '../ShareDialog'
import { Stat } from '../ui'
import { BookExport } from './BookExport'
import { Costs } from './Costs'
import { DayByDay } from './DayByDay'
import { Overview } from './Overview'

const PrintDocument = lazy(() => import('./PrintDocument').then((m) => ({ default: m.PrintDocument })))

const TABS = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: <LayoutDashboard size={16} /> },
  { id: 'days', label: 'Itinerary', short: 'Days', icon: <CalendarDays size={16} /> },
  { id: 'costs', label: 'Costs', short: 'Costs', icon: <PieChart size={16} /> },
  { id: 'book', label: 'Book & export', short: 'Book', icon: <ListChecks size={16} /> },
] as const
type Tab = (typeof TABS)[number]['id']

export function PlanView({ plan }: { plan: Plan }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [copied, setCopied] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const readOnly = usePlanReadOnly()
  const { signedIn } = useSession()
  // Signed-in trips are saved automatically; once saved, the planner can share them too.
  const tripId = useStore((s) => s.tripId)
  const canShare = signedIn && !!tripId && !readOnly
  const customised = useStore((s) => s.selection !== null) && !readOnly
  const resetSelection = usePlanAction('resetSelection')
  const display: Display = { currency: plan.display_currency || 'USD', rate: plan.usd_to_display || 1 }
  const chosen = plan.packages.find((p) => p.name === plan.recommended_package)
  const budget = plan.budget
  const budgetText =
    budget.user_stated && budget.amount != null && (budget.currency || 'USD') === display.currency
      ? formatLocal(budget.amount, budget.currency) + (budget.scope === 'per_person' ? ' pp' : '')
      : formatMoney(budget.planning_budget, display)
  const dates = plan.dates.start_date ? `${prettyDate(plan.dates.start_date)} – ${prettyDate(plan.dates.end_date, true)}` : 'Flexible dates'
  const over = plan.remaining_budget != null && plan.remaining_budget < 0
  const photo = useWikiImage([plan.cities[0], plan.destination], 1600)

  const copySummary = async () => {
    try {
      // Built in the browser: instant, no round trip to the planner.
      await navigator.clipboard.writeText(planOutline(plan))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard may be blocked; the download buttons still work */
    }
  }

  return (
    <div className="mx-auto max-w-6xl animate-fade-up space-y-5 2xl:max-w-7xl">
      <div className="relative overflow-hidden rounded-2xl bg-brand-900 text-white shadow-lift">
        {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className={clsx('absolute inset-0', photo ? 'bg-gradient-to-r from-brand-950/95 via-brand-950/75 to-brand-950/30' : 'bg-brand-900')} />
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-5 sm:p-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
              <span>{plan.origin || '—'}</span>
              <span aria-hidden="true">→</span>
              <span>{plan.destination || '—'}</span>
              {plan.cities.length > 1 && <span className="normal-case tracking-normal text-white/60">· {plan.cities.join(', ')}</span>}
            </div>
            <h1 className="mt-1.5 text-2xl font-extrabold sm:text-3xl lg:text-[2.1rem]">{plan.trip_summary}</h1>
            <div className="mt-3.5 flex flex-wrap gap-2 text-sm">
              <Pill>{dates}</Pill>
              <Pill><Users size={13} /> {plan.travelers || 1} traveler{(plan.travelers || 1) > 1 ? 's' : ''}</Pill>
              <Pill className="capitalize">{plan.pace || 'balanced'} pace</Pill>
              {plan.preferences.map((p) => <Pill key={p} className="capitalize">{p}</Pill>)}
            </div>
          </div>
          <div className="no-print flex gap-2">
            {canShare && (
              <button onClick={() => setSharing(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 text-sm font-semibold backdrop-blur transition hover:bg-white/20">
                <Share2 size={15} /> <span className="hidden sm:inline">Share</span>
              </button>
            )}
            <button onClick={() => void copySummary()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-3 text-sm font-semibold backdrop-blur transition hover:bg-white/20">
              {copied ? <Check size={15} /> : <Copy size={15} />} <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy summary'}</span>
            </button>
            <button
              onClick={() => setPrinting(true)}
              disabled={printing}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-coral-500 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-600 disabled:opacity-70"
            >
              <FileDown size={15} /> <span className="hidden sm:inline">{printing ? 'Preparing…' : 'Download PDF'}</span>
            </button>
          </div>
        </div>
      </div>

      {sharing && tripId && (
        <ShareDialog tripId={tripId} title={plan.trip_summary} subtitle={[plan.origin, plan.destination].filter(Boolean).join(' → ')} onClose={() => setSharing(false)} />
      )}

      {customised && (
        <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-900 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-brand-100">
          <SlidersHorizontal size={16} className="hidden shrink-0 sm:block" />
          <span className="min-w-[min(100%,16rem)] flex-1">
            <span className="font-semibold">{chosen ? `${chosen.label} package` : 'Your custom choices'}</span> — travel, hotels, timings and costs are updated. The rest of the itinerary is unchanged.
          </span>
          <button onClick={resetSelection} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-white/10">
            <RotateCcw size={14} /> Back to recommended
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Wallet size={13} />} label="Estimated total" value={formatMoney(plan.estimated_cost, display)} hint={chosen ? `${chosen.label} package` : 'Custom selection'} />
        <Stat icon={<PiggyBank size={13} />} label="Your budget" value={budgetText} hint={over ? 'Over budget' : 'Fits the plan'} />
        <Stat
          icon={<Wallet size={13} />}
          label={over ? 'Over budget by' : 'Left to spend'}
          value={<span className={over ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>{formatMoney(Math.abs(plan.remaining_budget ?? 0), display)}</span>}
          hint={over ? 'Try cheaper options below' : 'Shopping, tips & surprises'}
        />
        <Stat icon={<Luggage size={13} />} label="Getting there" value={<span className="text-[15px]">{plan.transport_choice?.label ?? '—'}</span>} hint={plan.transport_choice?.price_is_estimate ? 'Estimated fare' : plan.transport_choice ? 'Live fare' : undefined} />
      </div>

      {plan.parser_notes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-semibold">Good to know: </span>
          {plan.parser_notes.join(' ')}
        </div>
      )}

      <div className="no-print sticky top-16 z-[500] -mx-1 bg-[#f4f6f9]/95 px-1 py-2 backdrop-blur dark:bg-ink-900/95">
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-soft dark:border-white/10 dark:bg-ink-800">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={clsx(
                'flex min-w-0 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-1 py-1.5 text-[11px] font-semibold transition active:scale-95 sm:flex-row sm:gap-1.5 sm:px-3 sm:py-2 sm:text-sm',
                tab === item.id
                  ? 'bg-brand-700 text-white shadow-sm dark:bg-brand-500'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white',
              )}
            >
              {item.icon}
              <span className="sm:hidden">{item.short}</span>
              <span className="hidden truncate sm:inline">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <Overview plan={plan} display={display} />}
      {tab === 'days' && <DayByDay plan={plan} display={display} />}
      {tab === 'costs' && <Costs plan={plan} display={display} />}
      {tab === 'book' && <BookExport plan={plan} display={display} onPdf={() => setPrinting(true)} />}

      {printing && (
        <Suspense fallback={null}>
          <PrintDocument plan={plan} display={display} onDone={() => setPrinting(false)} />
        </Suspense>
      )}
    </div>
  )
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 py-1 font-medium backdrop-blur', className)}>{children}</span>
}
