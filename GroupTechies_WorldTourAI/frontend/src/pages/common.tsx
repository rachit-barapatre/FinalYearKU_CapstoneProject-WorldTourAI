import clsx from 'clsx'
import { CalendarDays, Layers, MapPin, Share2, Star, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { TripSummary } from '../lib/account'
import { prefetch } from '../lib/cache'
import { useWikiImage } from '../lib/images'
import { formatLocal, prettyDate } from '../lib/money'

export function Page({ title, subtitle, action, children, wide = false }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main className={clsx('mx-auto w-full flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-8', wide ? 'max-w-6xl 2xl:max-w-7xl' : 'max-w-4xl 2xl:max-w-5xl')}>
      <div className="mb-6 flex animate-fade-up flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </main>
  )
}

export function Panel({ title, description, children, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('animate-fade-up rounded-xl border border-slate-200 bg-white p-4 shadow-soft sm:p-6 dark:border-white/10 dark:bg-ink-800', className)}>
      {title && <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>}
      {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      <div className={title || description ? 'mt-4' : ''}>{children}</div>
    </section>
  )
}

export function money(amount: number | null | undefined, currency: string): string {
  return amount == null ? '—' : formatLocal(amount, currency || 'INR')
}

/** "just now", "5 min ago", "yesterday", or a date. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const minutes = Math.round((Date.now() - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function tripRoute(trip: Pick<TripSummary, 'origin' | 'destination' | 'cities'>): string {
  const where = trip.destination && trip.destination !== 'Multi-city' ? trip.destination : trip.cities.join(', ')
  return [trip.origin, where].filter(Boolean).join(' → ') || 'Trip details still being collected'
}

/** A photo of the trip's destination (from Wikipedia), or a map-pin tile while it loads. */
export function TripThumb({ trip, className }: { trip: Pick<TripSummary, 'destination' | 'cities'>; className?: string }) {
  const photo = useWikiImage([trip.destination !== 'Multi-city' ? trip.destination : null, trip.cities[0]], 320)
  return (
    <span className={clsx('relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-brand-100 to-brand-200 text-brand-700 dark:from-brand-500/20 dark:to-brand-700/30 dark:text-brand-200', className)}>
      <MapPin size={20} />
      {photo && <img src={photo} alt="" loading="lazy" className="absolute inset-0 h-full w-full animate-[fade-in_0.4s_ease-out] object-cover" />}
    </span>
  )
}

export function TripCard({ trip, actions }: { trip: TripSummary; actions?: ReactNode }) {
  return (
    <article className="lift group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-soft hover:border-brand-300 sm:flex-row sm:items-center sm:p-4 dark:border-white/10 dark:bg-ink-800 dark:hover:border-brand-400/40">
      <Link to={`/trips/${trip.id}`} onPointerEnter={() => prefetch(`/api/trips/${trip.id}`)} onFocus={() => prefetch(`/api/trips/${trip.id}`)} className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <TripThumb trip={trip} className="h-16 w-16 transition-transform duration-300 group-hover:scale-[1.03] sm:h-[72px] sm:w-[72px]" />
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">{trip.title}</h3>
          {trip.favorite && <Star size={14} className="fill-amber-400 text-amber-400" aria-label="Favourite" />}
          {trip.shared && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Share2 size={11} /> Shared</span>}
          {trip.status === 'archived' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">Archived</span>}
          {trip.status === 'planning' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Not planned yet</span>}
        </div>
        <div className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-300">{tripRoute(trip)}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {trip.startDate && <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {prettyDate(trip.startDate, true)}</span>}
          {trip.travelers && <span className="inline-flex items-center gap-1"><Users size={12} /> {trip.travelers}</span>}
          {trip.versions > 0 && <span className="inline-flex items-center gap-1"><Layers size={12} /> {trip.versions} plan{trip.versions > 1 ? 's' : ''}</span>}
          <span>Updated {ago(trip.updatedAt)}</span>
        </div>
        </div>
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 sm:flex-col sm:flex-nowrap sm:items-end sm:border-0 sm:pt-0 dark:border-white/5">
        <div className="text-right">
          <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{money(trip.estimatedCost, trip.currency)}</div>
          {trip.estimatedCost != null && <div className="text-[11px] text-slate-500">estimated total</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
    </article>
  )
}

export function IconButton({ label, onClick, children, tone = 'plain', pressed }: { label: string; onClick: () => void; children: ReactNode; tone?: 'plain' | 'danger'; pressed?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={clsx(
        'grid h-9 w-9 place-items-center rounded-lg border transition',
        tone === 'danger'
          ? 'border-slate-200 text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-white/10 dark:hover:bg-rose-500/10'
          : 'border-slate-200 text-slate-500 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5',
      )}
    >
      {children}
    </button>
  )
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
      {children}
      {onRetry && <button onClick={onRetry} className="ml-2 font-semibold underline">Try again</button>}
    </div>
  )
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
    </div>
  )
}
