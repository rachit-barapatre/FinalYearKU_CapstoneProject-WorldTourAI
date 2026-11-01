import { useClerk, useUser } from '@clerk/clerk-react'
import clsx from 'clsx'
import { AlertTriangle, Check, ChevronRight, Download, KeyRound, Laptop, Loader2, LogOut, Mail, Moon, ShieldCheck, Smartphone, Sun, Trash2, UserRound, Wrench } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PhotoCropper } from '../components/PhotoCropper'
import { Select } from '../components/Select'
import { ConfirmDialog } from '../components/ui'
import { Avatar } from '../components/UserMenu'
import { server, useAccount, type Preferences, type Profile, type TripSummary } from '../lib/account'
import { LANGUAGES } from '../lib/i18n'
import { toast } from '../lib/toast'
import { useStore } from '../store'
import { Page, Panel } from './common'

const TABS = [
  { id: 'profile', label: 'Profile', hint: 'Photo, name, phone', icon: <UserRound size={16} /> },
  { id: 'preferences', label: 'Preferences', hint: 'City, currency, theme', icon: <Wrench size={16} /> },
  { id: 'security', label: 'Security', hint: 'Email, password, devices', icon: <KeyRound size={16} /> },
  { id: 'account', label: 'Account', hint: 'Your data, delete', icon: <AlertTriangle size={16} /> },
] as const
type Tab = (typeof TABS)[number]['id']

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'THB', 'AUD', 'CAD', 'JPY']
const CITIES = ['Ahmedabad', 'Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Hyderabad', 'Kolkata', 'Pune', 'Jaipur', 'Surat', 'Lucknow', 'Kochi', 'Chandigarh', 'Indore', 'Nagpur', 'Bhubaneswar', 'Guwahati', 'Dubai', 'Singapore', 'London', 'New York']

function clerkMessage(error: unknown): string {
  const first = (error as { errors?: { longMessage?: string; message?: string }[] })?.errors?.[0]
  return first?.longMessage || first?.message || (error instanceof Error ? error.message : 'Something went wrong.')
}

export function SettingsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const tab = (TABS.find((t) => `#${t.id}` === location.hash)?.id ?? 'profile') as Tab
  const profile = useAccount((s) => s.profile)
  return (
    <Page wide title="Settings" subtitle="Manage your details, preferences and sign-in.">
      <div className="grid gap-5 md:grid-cols-[240px_1fr] lg:grid-cols-[260px_1fr]">
        <div className="min-w-0 space-y-4 md:sticky md:top-24 md:self-start">
          <div className="hidden animate-fade-up items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-soft md:flex dark:border-white/10 dark:bg-ink-800">
            <Avatar size={44} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{profile?.fullName || 'Your account'}</div>
              <div className="flex items-center gap-1 truncate text-xs text-slate-500"><ShieldCheck size={12} className="shrink-0 text-emerald-500" /> Secured by Clerk</div>
            </div>
          </div>
          <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:px-0" aria-label="Settings sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => navigate({ hash: t.id }, { replace: true })}
                aria-current={tab === t.id ? 'page' : undefined}
                className={clsx(
                  'group inline-flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition md:py-2.5',
                  tab === t.id ? 'bg-brand-700 text-white shadow-sm dark:bg-brand-500' : 'text-slate-600 hover:bg-white hover:shadow-soft dark:text-slate-300 dark:hover:bg-white/5',
                )}
              >
                <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-md transition', tab === t.id ? 'bg-white/15' : 'bg-slate-100 group-hover:bg-brand-50 group-hover:text-brand-700 dark:bg-white/5')}>{t.icon}</span>
                <span className="min-w-0 flex-1">
                  {t.label}
                  <span className={clsx('hidden truncate text-xs font-normal md:block', tab === t.id ? 'text-white/75' : 'text-slate-500')}>{t.hint}</span>
                </span>
                <ChevronRight size={15} className={clsx('hidden shrink-0 transition md:block', tab === t.id ? 'translate-x-0.5 opacity-100' : 'opacity-0 group-hover:opacity-60')} />
              </button>
            ))}
          </nav>
        </div>
        <div key={tab} className="min-w-0 space-y-5">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'preferences' && <PreferencesTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'account' && <AccountTab />}
        </div>
      </div>
    </Page>
  )
}

// --------------------------------------------------------------------------- shared bits

const input = 'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 disabled:bg-slate-50 disabled:text-slate-500 dark:border-white/15 dark:bg-ink-900 dark:text-white dark:disabled:bg-white/5'

function Label({ text, hint, children }: { text: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">{text}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

function SaveRow({ busy, saved, error, label = 'Save changes' }: { busy: boolean; saved: boolean; error: string | null; label?: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="submit" disabled={busy} className="btn-shine inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-brand-800 active:translate-y-0 disabled:opacity-60 dark:bg-brand-500">
        {busy && <Loader2 size={15} className="animate-spin" />} {label}
      </button>
      {saved && <span className="inline-flex animate-pop items-center gap-1 text-sm font-medium text-emerald-600"><Check size={15} /> Saved</span>}
      {error && <span className="text-sm font-medium text-rose-600">{error}</span>}
    </div>
  )
}

function useSaving() {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      await work()
      setSaved(true)
      toast.success('Changes saved.')
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(clerkMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, saved, error, run, setError }
}

// --------------------------------------------------------------------------- profile

function ProfileTab() {
  const profile = useAccount((s) => s.profile)
  const update = useAccount((s) => s.update)
  const setProfile = useAccount((s) => s.setProfile)
  const [fullName, setFullName] = useState(profile?.fullName ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [editingPhoto, setEditingPhoto] = useState(false)
  const save = useSaving()
  useEffect(() => {
    setFullName(profile?.fullName ?? '')
    setPhone(profile?.phone ?? '')
  }, [profile?.fullName, profile?.phone])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (fullName.trim().length < 2) return save.setError('Enter your full name.')
    if (phone.trim() && !/^\+?[0-9][0-9\s-]{6,18}$/.test(phone.trim())) return save.setError('Enter a valid phone number, e.g. +91 98765 43210.')
    void save.run(() => update({ fullName: fullName.trim(), phone: phone.trim() }))
  }

  return (
    <>
      <Panel title="Profile photo" description="Shown in the menu, on your profile and on trips you share.">
        {editingPhoto ? (
          <>
            <PhotoCropper onSaved={() => setEditingPhoto(false)} />
            <button onClick={() => setEditingPhoto(false)} className="mx-auto mt-3 block text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">Cancel</button>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <Avatar size={72} />
            <div className="flex gap-2">
              <button onClick={() => setEditingPhoto(true)} className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">
                {profile?.photoUrl ? 'Change photo' : 'Add a photo'}
              </button>
              {profile?.photoUrl && (
                <button
                  onClick={() => void server<{ user: Profile }>('/api/me/photo', { method: 'DELETE' }).then(({ user }) => setProfile(user))}
                  className="h-10 rounded-lg px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </Panel>
      <Panel title="Your details">
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label text="Full name"><input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className={input} /></Label>
          </div>
          <Label text="Email" hint="Change it under Security."><input value={profile?.email ?? ''} disabled className={input} /></Label>
          <Label text="Phone number"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+91 98765 43210" className={input} /></Label>
          <div className="sm:col-span-2">
            <SaveRow {...save} />
          </div>
        </form>
      </Panel>
    </>
  )
}

// --------------------------------------------------------------------------- preferences

function PreferencesTab() {
  const profile = useAccount((s) => s.profile)
  const update = useAccount((s) => s.update)
  const setLanguage = useStore((s) => s.setLanguage)
  const [prefs, setPrefs] = useState<Preferences>(profile?.preferences ?? { homeCity: '', currency: '', language: 'en', theme: 'system', readAloud: false })
  const save = useSaving()
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }))
    if (key === 'theme') {
      const dark = value === 'dark' || (value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save.run(async () => {
      await update({ preferences: prefs })
      // Apply straight away on this device.
      setLanguage(prefs.language)
      try {
        localStorage.setItem('wt-read-aloud', prefs.readAloud ? '1' : '0')
        if (prefs.theme === 'system') localStorage.removeItem('wt-theme')
        else localStorage.setItem('wt-theme', prefs.theme)
      } catch {
        /* applies for this visit */
      }
      const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', dark)
    })
  }

  return (
    <Panel title="Preferences" description="Used every time you plan while signed in.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Label text="Home city" hint="Trips start here when your message doesn't say where from.">
          <input list="home-cities" value={prefs.homeCity} onChange={(e) => set('homeCity', e.target.value)} placeholder="e.g. Ahmedabad" className={input} />
          <datalist id="home-cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Label>
        <Label text="Show prices in" hint="Unless your message names a currency.">
          <Select
            value={prefs.currency}
            onChange={(value) => set('currency', value)}
            options={[{ value: '', label: 'Automatic (from where you start)' }, ...CURRENCIES.map((c) => ({ value: c, label: c }))]}
          />
        </Label>
        <Label text="Chat language">
          <Select
            value={prefs.language}
            onChange={(value) => set('language', value)}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
          />
        </Label>
        <Label text="Theme">
          <Select<Preferences['theme']>
            value={prefs.theme}
            onChange={(value) => set('theme', value)}
            options={[
              { value: 'system', label: 'Same as my device', icon: <Laptop size={15} className="text-slate-400" /> },
              { value: 'light', label: 'Light', icon: <Sun size={15} className="text-slate-400" /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={15} className="text-slate-400" /> },
            ]}
          />
        </Label>
        <label className="flex items-center gap-3 sm:col-span-2">
          <input type="checkbox" checked={prefs.readAloud} onChange={(e) => set('readAloud', e.target.checked)} className="h-5 w-5 accent-brand-700" />
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Read the assistant's replies aloud</span>
        </label>
        <div className="sm:col-span-2">
          <SaveRow {...save} label="Save preferences" />
        </div>
      </form>
    </Panel>
  )
}

// --------------------------------------------------------------------------- security (Clerk)

function SecurityTab() {
  return (
    <>
      <EmailSection />
      <PasswordSection />
      <SessionsSection />
    </>
  )
}

function EmailSection() {
  const { user } = useUser()
  const setProfile = useAccount((s) => s.setProfile)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<Awaited<ReturnType<NonNullable<typeof user>['createEmailAddress']>> | null>(null)
  const save = useSaving()

  const start = (event: FormEvent) => {
    event.preventDefault()
    if (!user || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return save.setError('Enter a valid email address.')
    void save.run(async () => {
      const address = await user.createEmailAddress({ email: email.trim() })
      await address.prepareVerification({ strategy: 'email_code' })
      setPending(address)
    })
  }

  const verify = (event: FormEvent) => {
    event.preventDefault()
    if (!user || !pending) return
    void save.run(async () => {
      const verified = await pending.attemptVerification({ code: code.trim() })
      if (verified.verification.status !== 'verified') throw new Error('That code did not work. Check the latest email.')
      const old = user.primaryEmailAddress
      await user.update({ primaryEmailAddressId: verified.id })
      await old?.destroy().catch(() => undefined)
      const { user: profile } = await server<{ user: Profile }>('/api/me/refresh', { method: 'POST' })
      setProfile(profile)
      setPending(null)
      setEmail('')
      setCode('')
    })
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><Mail size={16} /> Email address</span>} description={<>Currently <b>{user?.primaryEmailAddress?.emailAddress}</b>. A new address is confirmed with a code before it replaces this one.</>}>
      {pending ? (
        <form onSubmit={verify} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><Label text={`Code sent to ${pending.emailAddress}`}><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className={input} autoFocus /></Label></div>
          <SaveRow {...save} label="Confirm new email" />
        </form>
      ) : (
        <form onSubmit={start} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><Label text="New email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={input} /></Label></div>
          <SaveRow {...save} label="Send code" />
        </form>
      )}
    </Panel>
  )
}

function PasswordSection() {
  const { user } = useUser()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [others, setOthers] = useState(true)
  const save = useSaving()
  const hasPassword = !!user?.passwordEnabled

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!user) return
    if (next.length < 8) return save.setError('Use at least 8 characters.')
    if (next !== confirm) return save.setError('The new passwords do not match.')
    void save.run(async () => {
      await user.updatePassword({ currentPassword: hasPassword ? current : undefined, newPassword: next, signOutOfOtherSessions: others })
      setCurrent('')
      setNext('')
      setConfirm('')
    })
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound size={16} /> Password</span>} description={hasPassword ? 'Change the password you sign in with.' : 'You sign in with Google. Set a password to also sign in with your email.'}>
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {hasPassword && <div className="sm:col-span-2"><Label text="Current password"><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className={input} /></Label></div>}
        <Label text="New password" hint="At least 8 characters"><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className={input} /></Label>
        <Label text="Confirm new password"><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={input} /></Label>
        <label className="flex items-center gap-3 sm:col-span-2">
          <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} className="h-5 w-5 accent-brand-700" />
          <span className="text-sm text-slate-700 dark:text-slate-200">Sign out of my other devices</span>
        </label>
        <div className="sm:col-span-2"><SaveRow {...save} label={hasPassword ? 'Change password' : 'Set password'} /></div>
      </form>
    </Panel>
  )
}

type DeviceSession = Awaited<ReturnType<NonNullable<ReturnType<typeof useUser>['user']>['getSessions']>>[number]

function SessionsSection() {
  const { user } = useUser()
  const clerk = useClerk()
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => void user?.getSessions().then(setSessions).catch((e) => setError(clerkMessage(e)))
  useEffect(load, [user])

  return (
    <Panel title={<span className="flex items-center gap-2"><Laptop size={16} /> Signed-in devices</span>} description="Sign out anywhere you no longer use.">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!sessions ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/10">
          {sessions.map((s) => {
            const a = s.latestActivity
            const current = s.id === clerk.session?.id
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300">{a?.isMobile ? <Smartphone size={18} /> : <Laptop size={18} />}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {[a?.browserName, a?.deviceType].filter(Boolean).join(' on ') || 'Browser'} {current && <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">This device</span>}
                  </div>
                  <div className="text-xs text-slate-500">{[a?.city, a?.country].filter(Boolean).join(', ')}{a?.city || a?.country ? ' · ' : ''}last active {new Date(s.lastActiveAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                </div>
                {!current && (
                  <button onClick={() => void s.revoke().then(load)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                    <LogOut size={14} /> Sign out
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// --------------------------------------------------------------------------- delete account

function AccountTab() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signOut } = useClerk()
  const navigate = useNavigate()
  const reset = useStore((s) => s.reset)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await server('/api/me', { method: 'DELETE' })
      useAccount.getState().clear()
      reset()
      // Leave the account pages first: signing out while still here would bounce to the sign-in page.
      navigate('/', { replace: true })
      await signOut({ redirectUrl: '/' }).catch(() => undefined)
      toast.success('Your account and all its trips were deleted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The account could not be deleted.')
      setBusy(false)
    }
  }

  return (
    <>
    <DataPanel />
    <Panel title={<span className="flex items-center gap-2 text-rose-600"><Trash2 size={16} /> Delete account</span>} description="Permanently deletes your account, profile photo, every saved trip, prompt and itinerary. This cannot be undone." className="border-rose-200 dark:border-rose-400/20">
      {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}
      <button onClick={() => setOpen(true)} className="h-10 rounded-lg bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-700">Delete my account</button>
      <ConfirmDialog
        open={open}
        tone="danger"
        icon={<Trash2 size={20} />}
        title="Delete your account?"
        focusConfirm={false}
        body={
          <>
            Everything will be deleted for good. Type <b>DELETE</b> to confirm.
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type DELETE to confirm" autoFocus className={clsx(input, 'mt-3')} />
          </>
        }
        confirmLabel={busy ? 'Deleting…' : 'Delete account'}
        onCancel={() => { setOpen(false); setTyped('') }}
        onConfirm={() => typed.trim() === 'DELETE' && !busy && void remove()}
      />
    </Panel>
    </>
  )
}

/** Download everything WorldTour keeps about you (profile and trip list) as a JSON file. */
function DataPanel() {
  const profile = useAccount((s) => s.profile)
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    try {
      const trips: TripSummary[] = []
      for (let page = 1; page <= 20; page++) {
        const data = await server<{ trips: TripSummary[]; pages: number }>(`/api/trips?limit=50&page=${page}&sort=recent`)
        trips.push(...data.trips)
        if (page >= data.pages) break
      }
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), profile, trips }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement('a'), { href: url, download: 'worldtour-my-data.json' })
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      toast.success(`Downloaded your profile and ${trips.length} trip${trips.length === 1 ? '' : 's'}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The download failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title={<span className="flex items-center gap-2"><Download size={16} /> Your data</span>} description="A copy of your profile and the list of your saved trips, as a JSON file.">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Stored by WorldTour', value: 'Profile, trips, prompts, plans' },
          { label: 'Stored by Clerk', value: 'Email, password, sessions' },
          { label: 'Stored by Cloudinary', value: profile?.photoUrl ? 'Your profile photo' : 'Nothing yet' },
        ].map((row) => (
          <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{row.label}</div>
            <div className="mt-0.5 text-sm font-medium text-slate-800 dark:text-slate-100">{row.value}</div>
          </div>
        ))}
      </div>
      <button onClick={() => void download()} disabled={busy} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-60 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download my data
      </button>
    </Panel>
  )
}
