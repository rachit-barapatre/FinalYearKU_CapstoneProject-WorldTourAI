import clsx from 'clsx'
import { Award, CalendarDays, Check, Compass, Globe2, Heart, Layers, Lock, Mail, MapPin, MessageSquareText, Pencil, Phone, Plane, Plus, Settings, Share2, Sparkles, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CountUp } from '../components/ui'
import { Avatar } from '../components/UserMenu'
import { useAccount, type Profile, type TripSummary } from '../lib/account'
import { useServerData } from '../lib/cache'
import { useWikiImage } from '../lib/images'
import { useStore } from '../store'
import { ErrorNote, money, Page, Panel, TripCard } from './common'

interface Stats {
  trips: number
  planned: number
  favorites: number
  plansGenerated: number
  prompts: number
  daysPlanned: number
  destinations: number
  topDestination: string | null
  budgetPlanned: { currency: string; amount: number }[]
  shared?: number
  places?: { name: string; trips: number }[]
  activity?: { month: string; trips: number }[]
}

/** A traveler "level" from the number of planned trips. */
function level(planned: number) {
  if (planned >= 15) return { name: 'Globetrotter', next: null, icon: <Globe2 size={14} /> }
  if (planned >= 6) return { name: 'Voyager', next: 15, icon: <Compass size={14} /> }
  if (planned >= 2) return { name: 'Explorer', next: 6, icon: <Plane size={14} /> }
  return { name: 'New traveler', next: 2, icon: <Sparkles size={14} /> }
}

export function ProfilePage() {
  const profile = useAccount((s) => s.profile)
  const { data, error, reload } = useServerData<{ stats: Stats; recent: TripSummary[] }>('/api/stats')
  const stats = data?.stats
  const cover = useWikiImage([stats?.topDestination, profile?.preferences.homeCity, 'Lake Palace'], 1600)
  const since = profile?.memberSince ? new Date(profile.memberSince).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : ''
  const rank = level(stats?.planned ?? 0)

  return (
    <Page wide title="Your profile" subtitle="Your travel story so far, all in one place.">
      <div className="space-y-5">
        {/* Cover with the destination you plan most */}
        <section className="relative animate-fade-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft dark:border-white/10 dark:bg-ink-800">
          <div className="relative h-32 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 sm:h-44">
            {cover && <img src={cover} alt="" className="animate-ken-burns absolute inset-0 h-full w-full object-cover opacity-70" />}
            <div className="absolute inset-0 bg-gradient-to-t from-brand-950/80 via-brand-950/20 to-transparent" />
            {stats?.topDestination && (
              <span className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
                <MapPin size={12} /> Most planned: {stats.topDestination}
              </span>
            )}
          </div>
          <div className="relative px-4 pb-5 sm:px-6">
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:text-left">
              <div className="-mt-14 shrink-0 animate-pop rounded-full bg-white p-1 shadow-lift dark:bg-ink-800">
                <Avatar size={104} />
              </div>
              <div className="min-w-0 flex-1 sm:pb-1">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <h2 className="truncate text-2xl font-extrabold text-slate-900 dark:text-white">{profile?.fullName || 'Traveler'}</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-coral-50 px-2.5 py-0.5 text-xs font-bold text-coral-600 ring-1 ring-coral-100 dark:bg-coral-500/15 dark:text-coral-400 dark:ring-coral-400/30">
                    {rank.icon} {rank.name}
                  </span>
                </div>
                <div className="mt-2 flex flex-col gap-1.5 text-sm text-slate-600 sm:flex-row sm:flex-wrap sm:gap-x-5 dark:text-slate-300">
                  {profile?.email && <span className="inline-flex min-w-0 items-center justify-center gap-1.5 sm:justify-start"><Mail size={14} className="shrink-0" /> <span className="truncate">{profile.email}</span></span>}
                  {profile?.phone && <span className="inline-flex items-center justify-center gap-1.5 sm:justify-start"><Phone size={14} /> {profile.phone}</span>}
                  {profile?.preferences.homeCity && <span className="inline-flex items-center justify-center gap-1.5 sm:justify-start"><MapPin size={14} /> {profile.preferences.homeCity}</span>}
                </div>
                {since && <p className="mt-1.5 text-xs text-slate-500">Member since {since}</p>}
              </div>
              <div className="flex gap-2">
                <Link to="/settings" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-brand-300 hover:bg-brand-50 dark:border-white/15 dark:bg-ink-900 dark:text-white dark:hover:bg-white/5">
                  <Pencil size={15} /> Edit profile
                </Link>
              </div>
            </div>
          </div>
        </section>

        {error && !data ? (
          <ErrorNote onRetry={reload}>{error}</ErrorNote>
        ) : (
          <>
            <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat tone="brand" icon={<Plane size={16} />} label="Trips planned" value={stats && <CountUp value={stats.planned} />} />
              <Stat tone="coral" icon={<MapPin size={16} />} label="Destinations" value={stats && <CountUp value={stats.destinations} />} />
              <Stat tone="green" icon={<CalendarDays size={16} />} label="Days of travel" value={stats && <CountUp value={stats.daysPlanned} />} />
              <Stat tone="violet" icon={<Layers size={16} />} label="Itineraries" value={stats && <CountUp value={stats.plansGenerated} />} />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title="Planning activity" description="Trips you started in the last six months.">
                <ActivityChart activity={stats?.activity} />
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4 dark:border-white/10">
                  <MiniStat icon={<MessageSquareText size={14} />} label="Prompts sent" value={stats?.prompts} />
                  <MiniStat icon={<Heart size={14} />} label="Favourites" value={stats?.favorites} />
                  <MiniStat icon={<Share2 size={14} />} label="Shared" value={stats?.shared} />
                  <MiniStat
                    icon={<Wallet size={14} />}
                    label="Budget planned"
                    value={stats ? (stats.budgetPlanned.length ? stats.budgetPlanned.map((b) => money(b.amount, b.currency)).join(' + ') : '—') : undefined}
                  />
                </div>
              </Panel>
              <Completeness profile={profile} planned={stats?.planned ?? 0} />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title="Recent trips" description="Pick up where you left off.">
                {!data ? (
                  <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>
                ) : data.recent.length ? (
                  <div className="stagger space-y-3">
                    {data.recent.map((trip) => <TripCard key={trip.id} trip={trip} />)}
                    <Link to="/history" className="inline-block pt-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">See all your trips →</Link>
                  </div>
                ) : (
                  <EmptyTrips />
                )}
              </Panel>
              <div className="space-y-5">
                <Places places={stats?.places} />
                <Achievements stats={stats} next={rank.next} />
              </div>
            </div>
          </>
        )}
      </div>
    </Page>
  )
}

const TONES = {
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200',
  coral: 'bg-coral-50 text-coral-600 dark:bg-coral-500/15 dark:text-coral-400',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: keyof typeof TONES }) {
  return (
    <div className="lift rounded-xl border border-slate-200 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-ink-800">
      <span className={clsx('grid h-9 w-9 place-items-center rounded-lg', TONES[tone])}>{icon}</span>
      <div className="mt-3 text-2xl font-extrabold tabular-nums text-slate-900 sm:text-3xl dark:text-white">{value ?? <span className="skeleton inline-block h-7 w-12 rounded" />}</div>
      <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{icon} {label}</div>
      <div className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900 dark:text-white">{value ?? '—'}</div>
    </div>
  )
}

function ActivityChart({ activity }: { activity?: { month: string; trips: number }[] }) {
  const months = activity ?? Array.from({ length: 6 }, (_, i) => ({ month: `m${i}`, trips: 0 }))
  const max = Math.max(1, ...months.map((m) => m.trips))
  return (
    <div className="flex h-40 items-end gap-2 sm:gap-4" role="img" aria-label={activity ? `Trips per month: ${months.map((m) => `${m.month} ${m.trips}`).join(', ')}` : 'Loading activity'}>
      {months.map((m, i) => {
        const label = activity ? new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' }) : ''
        return (
          <div key={m.month} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className="text-xs font-bold tabular-nums text-slate-700 opacity-0 transition group-hover:opacity-100 dark:text-slate-200">{m.trips}</span>
            <div className="relative w-full max-w-12 flex-1">
              <div
                className={clsx(
                  'absolute inset-x-0 bottom-0 origin-bottom rounded-t-lg transition-all duration-700 ease-out',
                  activity ? (i === months.length - 1 ? 'bg-gradient-to-t from-coral-500 to-coral-400' : 'bg-gradient-to-t from-brand-600 to-brand-400 group-hover:from-brand-700') : 'skeleton',
                )}
                style={{ height: activity ? `${Math.max(6, (m.trips / max) * 100)}%` : '30%', transitionDelay: `${i * 70}ms` }}
              />
            </div>
            <span className="text-xs font-medium text-slate-500">{label || ' '}</span>
          </div>
        )
      })}
    </div>
  )
}

function Completeness({ profile, planned }: { profile: Profile | null; planned: number }) {
  const steps = [
    { done: !!profile?.photoUrl, label: 'Add a profile photo', to: '/settings#profile' },
    { done: !!profile?.phone, label: 'Add your phone number', to: '/settings#profile' },
    { done: !!profile?.preferences.homeCity, label: 'Set your home city', to: '/settings#preferences' },
    { done: !!profile?.preferences.currency, label: 'Choose a currency', to: '/settings#preferences' },
    { done: planned > 0, label: 'Plan your first trip', to: '/' },
  ]
  const done = steps.filter((s) => s.done).length
  const pct = Math.round((done / steps.length) * 100)
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <Panel title="Profile strength" description={pct === 100 ? 'All set. Every trip uses your details.' : 'A complete profile gives better plans.'}>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 80 80" className="h-20 w-20 shrink-0 -rotate-90">
          <circle cx="40" cy="40" r={r} className="fill-none stroke-slate-100 dark:stroke-white/10" strokeWidth="8" />
          <circle cx="40" cy="40" r={r} className="fill-none stroke-brand-600 transition-[stroke-dashoffset] duration-1000 ease-out dark:stroke-brand-300" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
          <text x="40" y="40" dominantBaseline="central" textAnchor="middle" className="rotate-90 fill-slate-900 text-[17px] font-extrabold dark:fill-white" style={{ transformOrigin: '40px 40px' }}>{pct}%</text>
        </svg>
        <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
          {steps.map((s) => (
            <li key={s.label}>
              <Link to={s.to} className={clsx('flex items-center gap-2 rounded-md transition', s.done ? 'text-slate-400 line-through decoration-slate-300' : 'font-medium text-slate-700 hover:text-brand-700 dark:text-slate-200 dark:hover:text-brand-300')}>
                <span className={clsx('grid h-4 w-4 shrink-0 place-items-center rounded-full', s.done ? 'bg-emerald-500 text-white' : 'border border-slate-300 dark:border-white/20')}>{s.done && <Check size={10} strokeWidth={3} />}</span>
                <span className="truncate">{s.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

function Places({ places }: { places?: { name: string; trips: number }[] }) {
  return (
    <Panel title="Places you've planned">
      {!places ? (
        <div className="flex flex-wrap gap-2">{[0, 1, 2].map((i) => <span key={i} className="skeleton h-7 w-20 rounded-full" />)}</div>
      ) : places.length ? (
        <div className="stagger flex flex-wrap gap-2">
          {places.map((p) => (
            <span key={p.name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
              <MapPin size={12} className="text-coral-500" /> {p.name}
              {p.trips > 1 && <span className="rounded-full bg-brand-700 px-1.5 text-[10px] font-bold text-white dark:bg-brand-500">{p.trips}</span>}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Destinations appear here as you plan trips.</p>
      )}
    </Panel>
  )
}

function Achievements({ stats, next }: { stats?: Stats; next: number | null }) {
  const s = stats
  const badges = [
    { icon: <Plane size={16} />, label: 'First trip', done: (s?.planned ?? 0) >= 1 },
    { icon: <Compass size={16} />, label: '3 destinations', done: (s?.destinations ?? 0) >= 3 },
    { icon: <CalendarDays size={16} />, label: '15 days planned', done: (s?.daysPlanned ?? 0) >= 15 },
    { icon: <Share2 size={16} />, label: 'Shared a trip', done: (s?.shared ?? 0) >= 1 },
    { icon: <Heart size={16} />, label: 'A favourite', done: (s?.favorites ?? 0) >= 1 },
    { icon: <Award size={16} />, label: '5 trips planned', done: (s?.planned ?? 0) >= 5 },
  ]
  return (
    <Panel title="Achievements" description={next && s ? `${Math.max(0, next - s.planned)} more planned trip${next - s.planned === 1 ? '' : 's'} to the next level.` : undefined}>
      <div className="grid grid-cols-3 gap-2">
        {badges.map((b) => (
          <div
            key={b.label}
            title={b.done ? 'Unlocked' : 'Locked'}
            className={clsx('flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center text-[11px] font-semibold leading-tight transition', b.done ? 'border-coral-100 bg-coral-50 text-coral-600 dark:border-coral-400/30 dark:bg-coral-500/10 dark:text-coral-400' : 'border-slate-200 text-slate-400 dark:border-white/10')}
          >
            <span className={clsx('grid h-8 w-8 place-items-center rounded-full', b.done ? 'animate-pop bg-coral-500 text-white' : 'bg-slate-100 dark:bg-white/5')}>{b.done ? b.icon : <Lock size={13} />}</span>
            {b.label}
          </div>
        ))}
      </div>
    </Panel>
  )
}

function EmptyTrips() {
  const navigate = useNavigate()
  const reset = useStore((s) => s.reset)
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-white/15">
      <img src="/logo-globe.svg" alt="" width={56} height={56} className="float-slow mx-auto" />
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No trips yet. Your first plan is saved here automatically.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button onClick={() => { reset(); navigate('/') }} className="btn-shine inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 dark:bg-brand-500">
          <Plus size={15} /> Plan a trip
        </button>
        <Link to="/settings#preferences" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200"><Settings size={15} /> Preferences</Link>
      </div>
    </div>
  )
}
