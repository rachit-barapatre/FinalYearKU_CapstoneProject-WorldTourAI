import clsx from 'clsx'
import { Map, MessageSquare } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AccessCode } from './components/AccessCode'
import { ChatPanel } from './components/ChatPanel'
import { Header } from './components/Header'
import { Landing } from './components/Landing'
import { PlanningProgress } from './components/PlanningProgress'
import { TripBrief } from './components/TripBrief'
import { ACCOUNTS_ENABLED, SERVER_URL, useAccount, useSession } from './lib/account'
import { health } from './lib/api'
import { Toaster } from './lib/toast'
import { prefetch, tripsPath } from './lib/cache'
import { useTripSync } from './lib/tripSync'
import { useActivePlan, useStarted, useStore } from './store'

// Pages and the plan view (map and chart libraries) are separate chunks. They load on demand, and
// are fetched in the background once the first screen is up, so later clicks open them instantly.
const chunks = {
  plan: () => import('./components/plan/PlanView'),
  auth: () => import('./pages/AuthPage'),
  photo: () => import('./pages/PhotoSetup'),
  profile: () => import('./pages/ProfilePage'),
  settings: () => import('./pages/SettingsPage'),
  history: () => import('./pages/HistoryPage'),
  trip: () => import('./pages/TripPage'),
  shared: () => import('./pages/SharedTrip'),
  notFound: () => import('./pages/NotFound'),
}
const PlanView = lazy(() => chunks.plan().then((m) => ({ default: m.PlanView })))
const AuthPage = lazy(() => chunks.auth().then((m) => ({ default: m.AuthPage })))
const SsoCallback = lazy(() => chunks.auth().then((m) => ({ default: m.SsoCallback })))
const PhotoSetup = lazy(() => chunks.photo().then((m) => ({ default: m.PhotoSetup })))
const ProfilePage = lazy(() => chunks.profile().then((m) => ({ default: m.ProfilePage })))
const SettingsPage = lazy(() => chunks.settings().then((m) => ({ default: m.SettingsPage })))
const HistoryPage = lazy(() => chunks.history().then((m) => ({ default: m.HistoryPage })))
const TripPage = lazy(() => chunks.trip().then((m) => ({ default: m.TripPage })))
const SharedTrip = lazy(() => chunks.shared().then((m) => ({ default: m.SharedTrip })))
const NotFound = lazy(() => chunks.notFound().then((m) => ({ default: m.NotFound })))

function whenIdle(fn: () => void) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 4000 })
  else setTimeout(fn, 1500)
}

export default function App() {
  const { needsAccessCode, accessCode, setNeedsAccessCode } = useStore()
  useTripSync()
  usePreferences()

  useEffect(() => {
    // Also wakes the serverless API up early, so the first message answers faster.
    health()
      .then((info) => info.access_code_required && !accessCode && setNeedsAccessCode(true))
      .catch(() => undefined)
  }, [accessCode, setNeedsAccessCode])

  useEffect(() => {
    // Wake the accounts server too (a cold start takes a few seconds), then preload the other pages.
    if (ACCOUNTS_ENABLED) void fetch(`${SERVER_URL}/api/health`).catch(() => undefined)
    whenIdle(() => Object.values(chunks).forEach((load) => void load().catch(() => undefined)))
  }, [])
  usePrefetchAccount()

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sign-in/*" element={<AuthPage mode="sign-in" />} />
          <Route path="/sign-up/*" element={<AuthPage mode="sign-up" />} />
          <Route path="/sso-callback" element={<SsoCallback />} />
          <Route path="/onboarding/photo" element={<SignedIn><PhotoSetup /></SignedIn>} />
          <Route path="/profile" element={<SignedIn><ProfilePage /></SignedIn>} />
          <Route path="/settings" element={<SignedIn><SettingsPage /></SignedIn>} />
          <Route path="/history" element={<SignedIn><HistoryPage /></SignedIn>} />
          <Route path="/trips/:id" element={<SignedIn><TripPage /></SignedIn>} />
          <Route path="/share/:shareId" element={<SharedTrip />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      {needsAccessCode && <AccessCode />}
      <Toaster />
    </div>
  )
}

function Home() {
  const started = useStarted()
  return started ? <Workspace /> : <Landing />
}

export function PageLoading() {
  return <div className="grid flex-1 place-items-center py-24 text-sm text-slate-500"><img src="/logo-globe.svg" alt="Loading" width={56} height={56} /></div>
}

/** Account pages: signed-out visitors go to sign-in and come back here afterwards. */
function SignedIn({ children }: { children: ReactNode }) {
  const { loaded, signedIn } = useSession()
  const location = useLocation()
  if (!ACCOUNTS_ENABLED) return <Navigate to="/" replace />
  if (!loaded) return <PageLoading />
  if (!signedIn) return <Navigate to={`/sign-in?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <>{children}</>
}

/**
 * A signed-in traveler's saved preferences follow them: language, theme and read-aloud apply on sign-in,
 * and changing the chat language updates their settings. New accounts are offered the photo step once.
 */
/** Signed in: fetch the profile stats and the first page of My trips while the visitor is idle. */
function usePrefetchAccount() {
  const hasProfile = !!useAccount((s) => s.profile)
  useEffect(() => {
    if (hasProfile) whenIdle(() => { prefetch('/api/stats'); prefetch(tripsPath()) })
  }, [hasProfile])
}

function usePreferences() {
  const profile = useAccount((s) => s.profile)
  const update = useAccount((s) => s.update)
  const language = useStore((s) => s.language)
  const setLanguage = useStore((s) => s.setLanguage)
  const navigate = useNavigate()
  const location = useLocation()
  const applied = useRef<string | null>(null)

  useEffect(() => {
    if (!profile || applied.current === profile.id) return
    applied.current = profile.id
    const prefs = profile.preferences
    setLanguage(prefs.language)
    try {
      localStorage.setItem('wt-read-aloud', prefs.readAloud ? '1' : '0')
      if (prefs.theme !== 'system') localStorage.setItem('wt-theme', prefs.theme)
    } catch {
      /* preferences still apply for this visit */
    }
    if (prefs.theme !== 'system') document.documentElement.classList.toggle('dark', prefs.theme === 'dark')
    let skipped = false
    try {
      skipped = sessionStorage.getItem('wt-photo-later') === '1'
    } catch {
      /* ignore */
    }
    if (!profile.onboarded && !skipped && location.pathname === '/') navigate('/onboarding/photo')
  }, [profile, setLanguage, navigate, location.pathname])

  useEffect(() => {
    if (!profile || applied.current !== profile.id || profile.preferences.language === language) return
    const timer = setTimeout(() => void update({ preferences: { language } }).catch(() => undefined), 800)
    return () => clearTimeout(timer)
  }, [language, profile, update])
}

function Workspace() {
  const { plan, status } = useStore()
  const active = useActivePlan()
  const planning = status === 'planning'
  const [mobileView, setMobileView] = useState<'chat' | 'trip'>('chat')

  // On phones and tablets, jump to the trip view when planning starts or a new plan arrives.
  const marker = planning ? 'planning' : plan ? `${plan.trip_summary}|${plan.estimated_cost}` : 'none'
  const [lastMarker, setLastMarker] = useState(marker)
  if (marker !== lastMarker) {
    setLastMarker(marker)
    if (marker !== 'none') setMobileView('trip')
  }

  return (
    <>
      <main className="mx-auto grid w-full max-w-[110rem] flex-1 grid-cols-1 lg:grid-cols-[25rem_minmax(0,1fr)] xl:grid-cols-[27.5rem_minmax(0,1fr)]">
        <aside
          className={clsx(
            'min-h-0 min-w-0 border-slate-200/80 lg:sticky lg:top-16 lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col lg:border-r dark:border-white/10',
            mobileView === 'chat' ? 'flex h-[calc(100dvh-4rem-4rem)] flex-col' : 'hidden',
          )}
        >
          <ChatPanel />
        </aside>
        <section
          className={clsx(
            'min-w-0 px-4 pb-24 pt-5 sm:px-6 lg:block lg:pb-10 lg:pt-6',
            mobileView === 'trip' ? 'block' : 'hidden',
          )}
        >
          {planning ? (
            <PlanningProgress />
          ) : active ? (
            <Suspense fallback={<div className="py-24 text-center text-sm text-slate-500">Loading your plan…</div>}>
              <PlanView plan={active} />
            </Suspense>
          ) : (
            <TripBrief />
          )}
        </section>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-[1000] grid h-16 grid-cols-2 border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-white/10 dark:bg-ink-900/95"
        aria-label="Switch view"
      >
        {[
          { id: 'chat' as const, label: 'Chat', icon: <MessageSquare size={20} /> },
          { id: 'trip' as const, label: planning ? 'Planning…' : plan ? 'Your plan' : 'Trip brief', icon: <Map size={20} /> },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setMobileView(item.id)}
            className={clsx(
              'relative flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition',
              mobileView === item.id ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500',
            )}
          >
            {mobileView === item.id && <span className="absolute top-0 h-0.5 w-10 rounded-full bg-brand-700 dark:bg-brand-300" />}
            {item.icon}
            {item.label}
            {item.id === 'trip' && plan && mobileView === 'chat' && <span className="absolute right-[38%] top-2.5 h-2 w-2 rounded-full bg-coral-500" />}
          </button>
        ))}
      </nav>
    </>
  )
}
