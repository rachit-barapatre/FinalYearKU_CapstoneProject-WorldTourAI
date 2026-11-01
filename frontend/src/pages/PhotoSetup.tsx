import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar } from '../components/UserMenu'
import { PhotoCropper } from '../components/PhotoCropper'
import { server, useAccount, type Profile } from '../lib/account'

/** Right after sign-up: set a profile photo, or skip for now. */
export function PhotoSetup() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('redirect') || '/'
  const profile = useAccount((s) => s.profile)
  const setProfile = useAccount((s) => s.setProfile)
  const [skipping, setSkipping] = useState(false)
  const firstName = profile?.fullName.split(/\s+/)[0]

  const skip = async () => {
    setSkipping(true)
    try {
      sessionStorage.setItem('wt-photo-later', '1')
    } catch {
      /* ignore */
    }
    try {
      const { user } = await server<{ user: Profile }>('/api/me/onboarding', { method: 'POST' })
      setProfile(user)
    } catch {
      /* skipping still works; the step is offered again next time */
    }
    navigate(next, { replace: true })
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-soft sm:p-8 dark:border-white/10 dark:bg-ink-800">
        <div className="mx-auto mb-4 w-fit">
          <Avatar size={56} />
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">{firstName ? `Welcome, ${firstName}!` : 'Welcome to WorldTour!'}</h1>
        <p className="mx-auto mb-6 mt-1.5 max-w-sm text-sm text-slate-600 dark:text-slate-300">Add a profile photo so your trips and shared plans feel like yours. You can change it any time in Settings.</p>
        <PhotoCropper saveLabel="Save and continue" onSaved={() => navigate(next, { replace: true })} />
        <button onClick={() => void skip()} disabled={skipping} className="mt-5 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
          Skip for now
        </button>
      </div>
    </main>
  )
}
