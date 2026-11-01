import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-white shadow-soft dark:border-white/10 dark:bg-ink-800', className)}>
      {children}
    </div>
  )
}

export function SectionTitle({ icon, title, subtitle, action }: { icon?: ReactNode; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">{title}</h3>
          {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

const BADGE = {
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/30',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  red: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30',
  coral: 'bg-coral-50 text-coral-600 ring-coral-100 dark:bg-coral-500/15 dark:text-coral-400 dark:ring-coral-400/30',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10',
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: keyof typeof BADGE }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BADGE[tone])}>{children}</span>
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-soft dark:border-white/10 dark:bg-ink-800">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate font-display text-lg font-bold text-slate-900 sm:text-xl dark:text-white">{value}</div>
      {hint && <div className="truncate text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  )
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={clsx('font-medium text-brand-600 hover:underline dark:text-brand-300', className)}>
      {children}
    </a>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {/* Animated cartoon globe; the motion stops for people who prefer reduced motion. */}
      <img src="/logo-globe.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0 drop-shadow-sm" />
      {!compact && (
        <div className="leading-tight">
          <div className="font-display text-[17px] font-extrabold tracking-tight text-slate-900 dark:text-white">WorldTour</div>
          <div className="hidden text-[11px] font-medium text-slate-500 sm:block dark:text-slate-400">AI trip planner</div>
        </div>
      )}
    </div>
  )
}

/** A modal confirmation in the site's own style (instead of the browser's confirm box). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'brand',
  icon,
  onConfirm,
  onCancel,
  focusConfirm = true,
}: {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'brand' | 'danger'
  icon?: ReactNode
  onConfirm: () => void
  onCancel: () => void
  /** Off when the body has its own field to type in. */
  focusConfirm?: boolean
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    if (focusConfirm) confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open, onCancel, focusConfirm])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[3000] flex items-end justify-center p-4 sm:items-center" role="presentation">
      <div className="absolute inset-0 animate-[fade-in_0.15s_ease-out] bg-slate-950/50 backdrop-blur-[2px]" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative w-full max-w-md animate-fade-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-800"
      >
        <div className="flex gap-4 p-5 sm:p-6">
          {icon && (
            <span
              className={clsx(
                'grid h-11 w-11 shrink-0 place-items-center rounded-full',
                tone === 'danger' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200',
              )}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
            <div className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{body}</div>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3.5 sm:flex-row sm:justify-end sm:px-6 dark:border-white/10 dark:bg-white/[0.03]">
          <button
            onClick={onCancel}
            className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/15 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={clsx(
              'h-10 rounded-lg px-4 text-sm font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-ink-800',
              tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500' : 'bg-brand-700 hover:bg-brand-800 focus-visible:ring-brand-500',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Counts up from 0 to value when first shown (instantly for people who prefer reduced motion). */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || value <= 0) {
      const id = requestAnimationFrame(() => setShown(value))
      return () => cancelAnimationFrame(id)
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return <>{shown.toLocaleString('en-IN')}</>
}
