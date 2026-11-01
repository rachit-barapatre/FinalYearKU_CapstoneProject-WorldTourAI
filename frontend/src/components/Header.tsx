import clsx from 'clsx'
import { Moon, Plus, RotateCcw, Sun } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ACCOUNTS_ENABLED, useSession } from '../lib/account'
import { focusTripInput } from '../lib/focus'
import { prettyDate } from '../lib/money'
import { setTheme, useDarkTheme } from '../lib/theme'
import { useStarted, useStore } from '../store'
import { ConfirmDialog, Logo } from './ui'
import { UserMenu } from './UserMenu'

/** Always in the header, signed in or not, so it never appears and then disappears while the account loads. */
function ThemeToggle() {
  const dark = useDarkTheme()
  return (
    <button
      onClick={() => setTheme(!dark)}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="grid h-9 w-9 place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-white/10"
    >
      <span key={dark ? 'sun' : 'moon'} className="animate-pop">{dark ? <Sun size={18} /> : <Moon size={18} />}</span>
    </button>
  )
}

export function Header() {
  const hasConversation = useStarted()
  const location = useLocation()
  const navigate = useNavigate()
  const onHome = location.pathname === '/'
  // The planner layout (trip pill, wide header) only on the planner page.
  const started = hasConversation && onHome
  const { signedIn } = useSession()
  const { reset, status, summary, plan } = useStore()
  const busy = status !== 'idle'
  const [confirming, setConfirming] = useState(false)
  const closeConfirm = useCallback(() => setConfirming(false), [])
  // New trip: confirm when there is a conversation to clear; otherwise go to an empty planner.
  const askNewTrip = () => {
    if (busy) return
    if (hasConversation) return setConfirming(true)
    if (!onHome) navigate('/')
    setTimeout(focusTripInput, 50)
  }
  const trip = plan
    ? `${plan.destination ?? 'Your trip'}${plan.duration.days ? ` · ${plan.duration.days} days` : ''}`
    : summary?.destination
      ? `${summary.destination}${summary.start_date ? ` · ${prettyDate(summary.start_date)}` : ''}`
      : null

  return (
    <header
      className={clsx(
        'sticky top-0 z-[1000] border-b backdrop-blur-xl',
        started
          ? 'border-slate-200 bg-white/95 dark:border-white/10 dark:bg-ink-900/95'
          : 'border-slate-200/70 bg-white/90 dark:border-white/10 dark:bg-ink-900/90',
      )}
    >
      <div className={clsx('mx-auto flex h-16 items-center justify-between gap-3 px-4 sm:px-6', started ? 'max-w-[110rem]' : 'max-w-7xl')}>
        <button onClick={() => (onHome ? started && askNewTrip() : navigate('/'))} className="shrink-0" aria-label={onHome && started ? 'WorldTour — start a new trip' : 'WorldTour home'}>
          <Logo />
        </button>

        {started && trip && (
          <div className="hidden min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm md:flex dark:border-white/10 dark:bg-ink-800">
            <span className={clsx('h-2 w-2 shrink-0 rounded-full', busy ? 'animate-pulse bg-amber-400' : plan ? 'bg-emerald-500' : 'bg-brand-500')} />
            <span className="truncate font-medium text-slate-700 dark:text-slate-200">{trip}</span>
            <span className="text-slate-400">·</span>
            <span className="shrink-0 text-slate-500">{busy ? (status === 'planning' ? 'Planning…' : 'Thinking…') : plan ? 'Plan ready' : 'Collecting details'}</span>
          </div>
        )}

        {!started && onHome && (
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex dark:text-slate-300">
            <a href="#destinations" className="hover:text-slate-900 dark:hover:text-white">Destinations</a>
            <a href="#how" className="hover:text-slate-900 dark:hover:text-white">How it works</a>
            <a href="#features" className="hover:text-slate-900 dark:hover:text-white">Features</a>
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          {(hasConversation || !onHome || (ACCOUNTS_ENABLED && signedIn)) && (
            <button
              onClick={askNewTrip}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 disabled:opacity-40 dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              <Plus size={16} /> <span className="hidden sm:inline">New trip</span>
            </button>
          )}
          <ThemeToggle />
          {!hasConversation && onHome && !(ACCOUNTS_ENABLED && signedIn) && (
            <a
              href="#plan"
              onClick={(event) => {
                event.preventDefault()
                focusTripInput()
              }}
              className="ml-1 hidden h-9 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white transition hover:bg-brand-800 sm:inline-flex dark:bg-brand-500 dark:hover:bg-brand-400"
            >
              Start planning
            </a>
          )}
          <UserMenu />
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        icon={<RotateCcw size={20} />}
        title="Start a new trip?"
        body={
          <>
            {plan ? (
              <>Your plan for <span className="font-semibold text-slate-800 dark:text-white">{plan.destination ?? 'this trip'}</span> and the conversation will be cleared from the planner.</>
            ) : (
              'The conversation so far will be cleared from the planner.'
            )}{' '}
            {ACCOUNTS_ENABLED && signedIn
              ? 'It stays saved in My trips, so you can open it again any time.'
              : ACCOUNTS_ENABLED
                ? 'Tip: sign in to save it to My trips, or download the PDF first.'
                : 'Tip: download the PDF first if you want to keep it.'}
          </>
        }
        confirmLabel="Start new trip"
        cancelLabel="Keep this trip"
        onCancel={closeConfirm}
        onConfirm={() => {
          setConfirming(false)
          reset()
          if (!onHome) navigate('/')
          window.scrollTo({ top: 0 })
          setTimeout(focusTripInput, 80)
        }}
      />
    </header>
  )
}
