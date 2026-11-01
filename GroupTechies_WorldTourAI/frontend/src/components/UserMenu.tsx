import { useClerk } from '@clerk/clerk-react'
import clsx from 'clsx'
import { ChevronDown, History, Languages, LogOut, Settings, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ACCOUNTS_ENABLED, initials, useAccount, useSession } from '../lib/account'
import { LANGUAGES } from '../lib/i18n'
import { prefetch, tripsPath } from '../lib/cache'
import { toast } from '../lib/toast'
import { useStore } from '../store'

/** The signed-in traveler's photo, or their initials. */
export function Avatar({ size = 36, className }: { size?: number; className?: string }) {
  const profile = useAccount((s) => s.profile)
  const { clerkImage } = useSession()
  const url = profile?.photoUrl || clerkImage
  return url ? (
    <img src={url} alt="" width={size} height={size} className={clsx('shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-ink-800', className)} style={{ width: size, height: size }} />
  ) : (
    <span
      className={clsx('grid shrink-0 place-items-center rounded-full bg-brand-700 font-bold text-white ring-2 ring-white dark:bg-brand-500 dark:ring-ink-800', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(profile?.fullName, profile?.email)}
    </span>
  )
}

export function UserMenu() {
  if (!ACCOUNTS_ENABLED) return null
  return <AccountMenu />
}

function AccountMenu() {
  const { loaded, signedIn } = useSession()
  const location = useLocation()
  if (!loaded) return <span className="h-9 w-9 animate-pulse rounded-full bg-slate-200 dark:bg-white/10" />
  if (!signedIn) {
    // Already on the sign-in or sign-up page: the form is right there.
    if (/^\/(sign-in|sign-up|sso-callback)/.test(location.pathname)) return null
    const back = location.pathname === '/' ? '' : `?redirect=${encodeURIComponent(location.pathname)}`
    return (
      <Link to={`/sign-in${back}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-white/15 dark:bg-ink-800 dark:text-white dark:hover:bg-white/5">
        <UserRound size={16} /> <span className="hidden sm:inline">Sign in</span>
      </Link>
    )
  }
  return <SignedInMenu />
}

function SignedInMenu() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const profile = useAccount((s) => s.profile)
  const language = useStore((s) => s.language)
  const setLanguage = useStore((s) => s.setLanguage)
  const { signOut } = useClerk()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => box.current && !box.current.contains(event.target as Node) && setOpen(false)
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5'

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        className="flex items-center gap-1 rounded-full p-0.5 pr-1.5 transition hover:bg-slate-100 dark:hover:bg-white/10"
      >
        <Avatar size={34} />
        <ChevronDown size={14} className={clsx('text-slate-500 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-[2000] w-72 animate-fade-up rounded-xl border border-slate-200 bg-white p-2 shadow-lift dark:border-white/10 dark:bg-ink-800">
          <div className="flex items-center gap-3 border-b border-slate-100 px-2 pb-3 pt-1 dark:border-white/10">
            <Avatar size={42} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{profile?.fullName || 'Your account'}</div>
              <div className="truncate text-xs text-slate-500">{profile?.email}</div>
            </div>
          </div>
          <div className="py-1.5">
            <Link role="menuitem" to="/profile" onPointerEnter={() => prefetch('/api/stats')} className={item}><UserRound size={16} /> Profile</Link>
            <Link role="menuitem" to="/history" onPointerEnter={() => prefetch(tripsPath())} className={item}><History size={16} /> My trips</Link>
            <Link role="menuitem" to="/settings" className={item}><Settings size={16} /> Settings</Link>
          </div>
          <div className="border-t border-slate-100 px-3 py-2.5 dark:border-white/10">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><Languages size={13} /> Chat language</div>
            <div className="grid grid-cols-4 gap-1">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  aria-pressed={language === l.code}
                  title={l.label}
                  className={clsx('h-8 rounded-md text-xs font-semibold transition', language === l.code ? 'bg-brand-700 text-white dark:bg-brand-500' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300')}
                >
                  {l.short}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-100 pt-1.5 dark:border-white/10">
            <button
              role="menuitem"
              onClick={() => {
                // Leave account pages before signing out, or their sign-in guard bounces to /sign-in.
                navigate('/')
                const name = useAccount.getState().profile?.fullName?.split(/\s+/)[0]
                void signOut({ redirectUrl: '/' })
                  .then(() => {
                    useAccount.getState().clear()
                    toast.success(name ? `Signed out. See you soon, ${name}!` : 'You have been signed out.')
                  })
                  .catch(() => toast.error('Could not sign out. Please try again.'))
              }}
              className={clsx(item, 'text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10')}
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
