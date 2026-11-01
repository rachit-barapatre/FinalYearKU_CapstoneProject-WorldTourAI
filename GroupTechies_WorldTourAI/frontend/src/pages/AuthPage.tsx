import { AuthenticateWithRedirectCallback, useSignIn, useSignUp } from '@clerk/clerk-react'
import clsx from 'clsx'
import { ArrowLeft, Check, Eye, EyeOff, Loader2, Lock, Mail, Phone, ShieldCheck, User } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ACCOUNTS_ENABLED, useSession } from '../lib/account'
import { useWikiImage } from '../lib/images'

type Mode = 'sign-in' | 'sign-up'

const NEW_ACCOUNT = 'wt-new-account'

/** Clerk's error for a failed call, in plain words. */
function clerkMessage(error: unknown): string {
  const first = (error as { errors?: { longMessage?: string; message?: string; code?: string }[] })?.errors?.[0]
  if (first?.code === 'form_identifier_exists') return 'An account with this email already exists. Sign in instead.'
  if (first?.code === 'form_password_incorrect') return 'That password is not right. Try again or reset it.'
  if (first?.code === 'form_identifier_not_found') return 'No account uses this email. Check it, or create an account.'
  return first?.longMessage || first?.message || (error instanceof Error ? error.message : 'Something went wrong. Please try again.')
}

/** 0–4: length, mixed case, a number, a symbol. */
function strength(password: string): number {
  if (!password) return 0
  let score = password.length >= 8 ? 1 : 0
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  return password.length >= 12 ? Math.min(4, score + 1) : score
}

export function AuthPage({ mode }: { mode: Mode }) {
  const { loaded, signedIn } = useSession()
  const [params] = useSearchParams()
  const redirect = params.get('redirect') || '/'
  const photos = [useWikiImage(['Lake Palace'], 1280), useWikiImage(['Taj Mahal'], 1280), useWikiImage(['Kerala backwaters'], 1280)]

  if (!ACCOUNTS_ENABLED) {
    return (
      <Shell photos={photos}>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Accounts are coming soon</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">You can plan trips as a guest right now. Saving trips and history will appear here once accounts are switched on.</p>
        <Link to="/" className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">Plan a trip</Link>
      </Shell>
    )
  }
  if (loaded && signedIn) {
    // A brand-new account goes to the photo step first, whichever redirect fires first after sign-up.
    let fresh = false
    try {
      fresh = sessionStorage.getItem(NEW_ACCOUNT) === '1'
      sessionStorage.removeItem(NEW_ACCOUNT)
    } catch {
      /* ignore */
    }
    return <Navigate to={fresh ? `/onboarding/photo${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}` : redirect} replace />
  }
  // key: switching between sign-in and sign-up replays the entrance animation.
  return <Shell photos={photos}><div key={mode}>{mode === 'sign-up' ? <SignUpForm redirect={redirect} /> : <SignInForm redirect={redirect} />}</div></Shell>
}

const SLIDES = [
  { place: 'Udaipur, India', line: 'Lake palaces, planned hour by hour.' },
  { place: 'Agra, India', line: 'Flights, trains, hotels and days in one plan.' },
  { place: 'Kerala, India', line: 'Slow backwaters at your own pace.' },
]

function Shell({ photos, children }: { photos: (string | null)[]; children: ReactNode }) {
  // A slow slideshow of destinations; motion stops for people who prefer reduced motion (index.css).
  const [slide, setSlide] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 6000)
    return () => clearInterval(timer)
  }, [])
  return (
    <main className="grid flex-1 lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-brand-950 text-white lg:block">
        {photos.map((photo, i) =>
          photo ? (
            <img key={i} src={photo} alt="" className={clsx('animate-ken-burns absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms]', i === slide ? 'opacity-80' : 'opacity-0')} />
          ) : null,
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-brand-950 via-brand-950/60 to-brand-950/20" />
        <svg className="pointer-events-none absolute right-10 top-16 h-40 w-72 text-white/40" viewBox="0 0 300 160" fill="none" aria-hidden="true">
          <path id="flight-path" d="M10 150 C 90 20, 200 20, 290 70" stroke="currentColor" strokeWidth="2" strokeDasharray="6 8" className="animate-dash" />
          <path d="M-7 -5 L9 0 L-7 5 L-4 0 Z" fill="white">
            <animateMotion dur="9s" repeatCount="indefinite" rotate="auto">
              <mpath href="#flight-path" />
            </animateMotion>
          </path>
        </svg>
        <div className="relative flex h-full flex-col justify-end p-10 xl:p-14">
          <div key={slide} className="mb-6 animate-fade-up">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-coral-400">{SLIDES[slide].place}</div>
            <div className="mt-1 text-sm text-white/80">{SLIDES[slide].line}</div>
          </div>
          <h2 className="max-w-md animate-fade-up text-3xl font-extrabold leading-tight xl:text-4xl">Every trip you plan, saved and ready to book.</h2>
          <ul className="stagger mt-6 space-y-2.5 text-sm text-white/85">
            {['Your prompts and every itinerary, in one history', 'Pick up any trip where you left off', 'Share a read-only plan with family and friends', 'Your home city, currency and language remembered'].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-coral-500"><Check size={12} strokeWidth={3} /></span>
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex gap-1.5">
            {SLIDES.map((s, i) => (
              <button key={s.place} onClick={() => setSlide(i)} aria-label={`Show ${s.place}`} className={clsx('h-1.5 rounded-full transition-all duration-500', i === slide ? 'w-8 bg-white' : 'w-3 bg-white/40 hover:bg-white/70')} />
            ))}
          </div>
        </div>
      </aside>
      <section className="relative flex items-center justify-center overflow-hidden px-4 py-8 sm:px-8 sm:py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 animate-blob rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-500/15" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 animate-blob rounded-full bg-coral-100/60 blur-3xl [animation-delay:-6s] dark:bg-coral-500/10" aria-hidden="true" />
        <div className="relative w-full max-w-md animate-fade-up rounded-2xl border border-slate-200/70 bg-white/85 p-5 shadow-lift backdrop-blur sm:p-8 dark:border-white/10 dark:bg-ink-800/85">{children}</div>
      </section>
    </main>
  )
}

function Field({
  label,
  icon,
  error,
  hint,
  children,
}: {
  label: string
  icon: ReactNode
  error?: string | null
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
      <span
        className={clsx(
          'group/field flex items-center gap-2 rounded-lg border bg-white px-3 transition duration-200 focus-within:-translate-y-px focus-within:shadow-soft focus-within:ring-4 dark:bg-ink-800',
          error ? 'border-rose-400 focus-within:ring-rose-500/15' : 'border-slate-300 focus-within:border-brand-500 focus-within:ring-brand-500/15 dark:border-white/15',
        )}
      >
        <span className="text-slate-400 transition-colors group-focus-within/field:text-brand-600 dark:group-focus-within/field:text-brand-300">{icon}</span>
        {children}
      </span>
      {error ? <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span> : hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

const inputClass = 'h-11 min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-white'

function PasswordInput({ value, onChange, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <>
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} className={inputClass} required />
      <button type="button" onClick={() => setShow(!show)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </>
  )
}

function GoogleButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/15 dark:bg-ink-800 dark:text-white dark:hover:bg-white/5"
    >
      <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      Continue with Google
    </button>
  )
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-slate-400">
      <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" /> or <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
    </div>
  )
}

function Alert({ children }: { children: ReactNode }) {
  return <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">{children}</div>
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} className="btn-shine flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand-700 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-brand-800 hover:shadow-lift active:translate-y-0 disabled:opacity-60 dark:bg-brand-500 dark:hover:bg-brand-400">
      {busy && <Loader2 size={16} className="animate-spin" />} {children}
    </button>
  )
}

// --------------------------------------------------------------------------- sign up

function SignUpForm({ redirect }: { redirect: string }) {
  const { isLoaded, signUp, setActive } = useSignUp()
  const navigate = useNavigate()
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '' })
  const [touched, setTouched] = useState(false)
  const [step, setStep] = useState<'details' | 'verify'>('details')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  const problems = {
    fullName: form.fullName.trim().split(/\s+/).filter(Boolean).length < 1 || form.fullName.trim().length < 2 ? 'Enter your full name.' : null,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? null : 'Enter a valid email address.',
    phone: /^\+?[0-9][0-9\s-]{6,18}$/.test(form.phone.trim()) ? null : 'Enter a valid phone number, e.g. +91 98765 43210.',
    password: form.password.length >= 8 ? null : 'Use at least 8 characters.',
    confirm: form.confirm && form.confirm === form.password ? null : 'The passwords do not match.',
  }
  const valid = Object.values(problems).every((p) => !p)
  const score = strength(form.password)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!valid || !isLoaded) return
    setBusy(true)
    setError(null)
    try {
      const [firstName, ...rest] = form.fullName.trim().split(/\s+/)
      await signUp.create({
        firstName,
        lastName: rest.join(' ') || undefined,
        emailAddress: form.email.trim(),
        password: form.password,
        // The phone number is stored on the WorldTour profile (Clerk SMS verification is not required).
        unsafeMetadata: { phone: form.phone.trim(), fullName: form.fullName.trim() },
      })
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      setStep('verify')
    } catch (e) {
      setError(clerkMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (event: FormEvent) => {
    event.preventDefault()
    if (!isLoaded) return
    setBusy(true)
    setError(null)
    try {
      const result = await signUp.attemptEmailAddressVerification({ code: code.trim() })
      if (result.status === 'complete') {
        try {
          sessionStorage.setItem(NEW_ACCOUNT, '1')
        } catch {
          /* the navigate below still goes to the photo step */
        }
        await setActive({ session: result.createdSessionId })
        navigate(`/onboarding/photo${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`, { replace: true })
      } else {
        setError('Almost there — some details are still missing. Please try again.')
      }
    } catch (e) {
      setError(clerkMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    if (!isLoaded) return
    setBusy(true)
    try {
      await signUp.authenticateWithRedirect({ strategy: 'oauth_google', redirectUrl: '/sso-callback', redirectUrlComplete: redirect })
    } catch (e) {
      setError(clerkMessage(e))
      setBusy(false)
    }
  }

  if (step === 'verify') {
    return (
      <form onSubmit={verify} noValidate>
        <button type="button" onClick={() => setStep('details')} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
          <ArrowLeft size={15} /> Back
        </button>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"><Mail size={22} /></span>
        <h1 className="mt-4 text-2xl font-extrabold text-slate-900 dark:text-white">Check your email</h1>
        <p className="mb-6 mt-1.5 text-sm text-slate-600 dark:text-slate-300">We sent a 6-digit code to <b className="text-slate-900 dark:text-white">{form.email}</b>.</p>
        {error && <Alert>{error}</Alert>}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-label="Verification code"
          placeholder="••••••"
          className="mb-4 h-14 w-full rounded-lg border border-slate-300 bg-white text-center font-mono text-2xl tracking-[0.5em] text-slate-900 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/15 dark:bg-ink-800 dark:text-white"
        />
        <Submit busy={busy}>Verify and continue</Submit>
        <button
          type="button"
          onClick={() => void signUp?.prepareEmailAddressVerification({ strategy: 'email_code' }).then(() => setError(null)).catch((e) => setError(clerkMessage(e)))}
          className="mt-4 w-full text-center text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
        >
          Send a new code
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="stagger">
      <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-white">Create your account</h1>
      <p className="mb-6 mt-1.5 text-sm text-slate-600 dark:text-slate-300">
        Already have one? <Link to={`/sign-in${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Sign in</Link>
      </p>
      {error && <Alert>{error}</Alert>}
      <GoogleButton onClick={() => void google()} busy={busy} />
      <Divider />
      <div className="space-y-4">
        <Field label="Full name" icon={<User size={17} />} error={touched ? problems.fullName : null}>
          <input value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} autoComplete="name" placeholder="Priya Sharma" className={inputClass} required />
        </Field>
        <Field label="Email" icon={<Mail size={17} />} error={touched ? problems.email : null}>
          <input type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} autoComplete="email" placeholder="you@example.com" className={inputClass} required />
        </Field>
        <Field label="Phone number" icon={<Phone size={17} />} error={touched ? problems.phone : null}>
          <input type="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} autoComplete="tel" placeholder="+91 98765 43210" className={inputClass} required />
        </Field>
        <Field
          label="Password"
          icon={<Lock size={17} />}
          error={touched ? problems.password : null}
          hint={
            <span className="flex items-center gap-2">
              <span className="flex flex-1 gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={clsx('h-1 flex-1 rounded-full', i <= score ? (score <= 1 ? 'bg-rose-500' : score <= 2 ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-slate-200 dark:bg-white/10')} />
                ))}
              </span>
              {form.password ? ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] : 'At least 8 characters'}
            </span>
          }
        >
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="Create a password (8+ characters)" />
        </Field>
        <Field label="Confirm password" icon={<ShieldCheck size={17} />} error={touched ? problems.confirm : null}>
          <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" placeholder="Type the password again" />
        </Field>
      </div>
      {/* Clerk's bot protection renders here when it is switched on for the application. */}
      <div id="clerk-captcha" className="mt-4" />
      <div className="mt-6">
        <Submit busy={busy}>Create account</Submit>
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">Your password is stored securely by Clerk; WorldTour never sees or stores it.</p>
    </form>
  )
}

// --------------------------------------------------------------------------- sign in

function SignInForm({ redirect }: { redirect: string }) {
  const { isLoaded, signIn, setActive } = useSignIn()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState<'password' | 'reset-request' | 'reset'>('password')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const finish = async (result: { status: string | null; createdSessionId: string | null }) => {
    if (result.status === 'complete') {
      await setActive!({ session: result.createdSessionId })
      navigate(redirect, { replace: true })
    } else if (result.status === 'needs_second_factor') {
      setError('This account uses two-step verification, which this page does not support yet.')
    } else {
      setError('Sign-in needs another step. Please try again.')
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isLoaded) return
    setBusy(true)
    setError(null)
    try {
      await finish(await signIn.create({ identifier: email.trim(), password }))
    } catch (e) {
      setError(clerkMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const requestReset = async (event: FormEvent) => {
    event.preventDefault()
    if (!isLoaded) return
    setBusy(true)
    setError(null)
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email.trim() })
      setStep('reset')
      setNote(`We sent a code to ${email.trim()}.`)
    } catch (e) {
      setError(clerkMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (event: FormEvent) => {
    event.preventDefault()
    if (!isLoaded) return
    if (password.length < 8) return setError('Use at least 8 characters for the new password.')
    setBusy(true)
    setError(null)
    try {
      await finish(await signIn.attemptFirstFactor({ strategy: 'reset_password_email_code', code: code.trim(), password }))
    } catch (e) {
      setError(clerkMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const google = async () => {
    if (!isLoaded) return
    setBusy(true)
    try {
      await signIn.authenticateWithRedirect({ strategy: 'oauth_google', redirectUrl: '/sso-callback', redirectUrlComplete: redirect })
    } catch (e) {
      setError(clerkMessage(e))
      setBusy(false)
    }
  }

  if (step !== 'password') {
    return (
      <form onSubmit={step === 'reset-request' ? requestReset : reset} noValidate className="stagger">
        <button type="button" onClick={() => { setStep('password'); setError(null); setNote(null) }} className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
          <ArrowLeft size={15} /> Back to sign in
        </button>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Reset your password</h1>
        <p className="mb-6 mt-1.5 text-sm text-slate-600 dark:text-slate-300">{note ?? 'Enter your email and we’ll send you a code.'}</p>
        {error && <Alert>{error}</Alert>}
        <div className="space-y-4">
          {step === 'reset-request' ? (
            <Field label="Email" icon={<Mail size={17} />}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className={inputClass} required autoFocus />
            </Field>
          ) : (
            <>
              <Field label="Code from the email" icon={<ShieldCheck size={17} />}>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" className={inputClass} required autoFocus />
              </Field>
              <Field label="New password" icon={<Lock size={17} />} hint="At least 8 characters">
                <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder="New password (8+ characters)" />
              </Field>
            </>
          )}
        </div>
        <div className="mt-6">
          <Submit busy={busy}>{step === 'reset-request' ? 'Send code' : 'Set new password and sign in'}</Submit>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="stagger">
      <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-white">Welcome back <span className="inline-block origin-[70%_70%] animate-wave" aria-hidden="true">👋</span></h1>
      <p className="mb-6 mt-1.5 text-sm text-slate-600 dark:text-slate-300">
        New to WorldTour? <Link to={`/sign-up${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Create an account</Link>
      </p>
      {error && <Alert>{error}</Alert>}
      <GoogleButton onClick={() => void google()} busy={busy} />
      <Divider />
      <div className="space-y-4">
        <Field label="Email" icon={<Mail size={17} />}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className={inputClass} required />
        </Field>
        <Field label="Password" icon={<Lock size={17} />}>
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password" />
        </Field>
      </div>
      <div className="mt-2 text-right">
        <button type="button" onClick={() => { setStep('reset-request'); setError(null) }} className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">Forgot password?</button>
      </div>
      <div className="mt-5">
        <Submit busy={busy}>Sign in</Submit>
      </div>
    </form>
  )
}

/** Google sends the traveler back here; Clerk finishes the sign-in and moves on. */
export function SsoCallback() {
  return (
    <div className="grid flex-1 place-items-center py-24">
      <img src="/logo-globe.svg" alt="" width={56} height={56} />
      <AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/onboarding/photo" />
    </div>
  )
}
