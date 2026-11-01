import { BookmarkCheck, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSession } from '../lib/account'
import { discardGuestDraft } from '../lib/ownership'
import { toast } from '../lib/toast'
import { useStore } from '../store'

const AUTH_PAGES = /^\/(sign-in|sign-up|sso-callback)/

const button =
  'inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold transition'
const primary = `${button} bg-brand-700 text-white hover:bg-brand-800 dark:bg-brand-500`
const secondary = `${button} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-white/15 dark:bg-ink-800 dark:text-white dark:hover:bg-white/5`

/**
 * The guest-to-account hand-off, always the traveler's own choice.
 *  - A guest with a plan is invited to create an account (the trip stays in this browser while they do).
 *  - After signing in, a trip planned as a guest is saved only if they press "Save to my account".
 */
export function GuestTripPrompt() {
  const { enabled, loaded, signedIn, userId } = useSession()
  const location = useLocation()
  const ownerId = useStore((s) => s.ownerId)
  const hasPlan = useStore((s) => !!s.plan)
  const hasDraft = useStore((s) => s.messages.some((m) => m.role === 'user') || !!s.plan)
  const label = useStore((s) => s.plan?.destination || s.messages.find((m) => m.role === 'user')?.content.slice(0, 60) || 'your trip')
  const claimDraft = useStore((s) => s.claimDraft)
  const [dismissed, setDismissed] = useState(false)

  if (!enabled || !loaded || AUTH_PAGES.test(location.pathname)) return null

  if (signedIn && userId && ownerId === null && hasDraft) {
    return (
      <div role="region" aria-label="Save your trip" className="border-b border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-white/10 dark:bg-white/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
          <BookmarkCheck size={18} className="shrink-0 text-brand-700 dark:text-brand-300" />
          <p className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
            You planned <b className="font-semibold text-slate-900 dark:text-white">{label}</b> before signing in. Save it to your account?
          </p>
          <div className="flex gap-2">
            <button
              className={primary}
              onClick={() => {
                claimDraft(userId)
                toast.success('Saving this trip to your account…')
              }}
            >
              Save to my account
            </button>
            <button className={secondary} onClick={() => discardGuestDraft(userId)}>
              Don’t save
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!signedIn && ownerId === null && hasPlan && !dismissed) {
    return (
      <div role="region" aria-label="Create an account to save this trip" className="border-b border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-white/10 dark:bg-white/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
          <BookmarkCheck size={18} className="shrink-0 text-brand-700 dark:text-brand-300" />
          <p className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">
            Create a free account to save this trip and find it again in My trips. It stays here while you sign up.
          </p>
          <div className="flex items-center gap-2">
            <Link to="/sign-up" className={primary}>Create account</Link>
            <Link to="/sign-in" className={secondary}>Sign in</Link>
            <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/60 dark:hover:bg-white/10">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
