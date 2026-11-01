import clsx from 'clsx'
import { CheckCircle2, Compass, Loader2, XCircle } from 'lucide-react'
import { useProgress } from '../lib/progress'
import { useStore } from '../store'
import { Card } from './ui'

export function PlanningProgress() {
  const notice = useStore((s) => s.notice)
  const { states, visible, finished, total } = useProgress()

  return (
    <div className="mx-auto max-w-2xl animate-fade-up py-4 lg:py-10">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl bg-brand-800 text-white shadow-lift dark:bg-brand-500">
          <Compass className="animate-spin [animation-duration:3s]" size={26} />
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">Building your trip</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {notice ?? 'Our agents work in parallel — this usually takes under a minute.'}
        </p>
        <div className="mx-auto mt-5 max-w-xs">
          <div className="mb-1.5 flex justify-between text-xs font-semibold text-slate-500">
            <span>{finished} of {total} steps</span>
            <span>{Math.round((finished / Math.max(total, 1)) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-brand-700 dark:bg-brand-400 transition-all duration-700"
              style={{ width: `${Math.max(5, (finished / Math.max(total, 1)) * 100)}%` }}
            />
          </div>
        </div>
      </div>
      <Card className="divide-y divide-slate-100 dark:divide-white/5">
        {visible.map((step) => {
          const state = states[step.id]
          return (
            <div key={step.id} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
              <span
                className={clsx(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-xl transition',
                  state === 'done' && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
                  state === 'failed' && 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
                  state === 'working' && 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
                )}
              >
                {step.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{step.label}</div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {state === 'done' ? step.done : state === 'failed' ? "Couldn't load right now — the plan continues without it" : 'Working on it…'}
                </div>
              </div>
              {state === 'done' && <CheckCircle2 className="shrink-0 text-emerald-500" size={20} />}
              {state === 'working' && <Loader2 className="shrink-0 animate-spin text-brand-500" size={20} />}
              {state === 'failed' && <XCircle className="shrink-0 text-amber-500" size={20} />}
            </div>
          )
        })}
      </Card>
    </div>
  )
}
