// Accounts: Clerk for sign-in, the WorldTour server (server/) for the profile, saved trips and history.
// Without VITE_CLERK_PUBLISHABLE_KEY the site runs exactly as before, guest-only.

import { useAuth, useUser } from '@clerk/clerk-react'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { create } from 'zustand'
import { setChatDefaults } from './api'
import type { Lang } from './i18n'

export const CLERK_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim() || ''
export const SERVER_URL = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').trim().replace(/\/$/, '')
export const ACCOUNTS_ENABLED = !!CLERK_KEY && !!SERVER_URL

export interface Preferences {
  homeCity: string
  currency: string
  language: Lang
  theme: 'system' | 'light' | 'dark'
  readAloud: boolean
}

export interface Profile {
  id: string
  fullName: string
  email: string
  phone: string
  photoUrl: string
  onboarded: boolean
  preferences: Preferences
  memberSince: string
}

export interface TripSummary {
  id: string
  title: string
  firstPrompt: string
  origin: string
  destination: string
  cities: string[]
  durationDays: number | null
  startDate: string
  travelers: number | null
  estimatedCost: number | null
  currency: string
  status: 'planning' | 'planned' | 'archived'
  favorite: boolean
  versions: number
  messages: number
  shared: boolean
  lastPlannedAt: string | null
  createdAt: string
  updatedAt: string
}

export class ServerError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// --------------------------------------------------------------------------- who is signed in

interface Session {
  enabled: boolean
  loaded: boolean
  signedIn: boolean
  clerkImage: string
  getToken: () => Promise<string | null>
}

const SIGNED_OUT: Session = { enabled: false, loaded: true, signedIn: false, clerkImage: '', getToken: async () => null }
const SessionContext = createContext<Session>(SIGNED_OUT)

/** The signed-in state; safe to call whether or not accounts are configured. */
export const useSession = () => useContext(SessionContext)

let tokenSource: () => Promise<string | null> = async () => null

/** Rendered inside <ClerkProvider>: exposes Clerk's state to the rest of the app and loads the profile. */
export function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const { user } = useUser()
  const value = useMemo<Session>(
    // Clerk's generic placeholder is not a photo: only a real one (e.g. from Google) is used.
    () => ({ enabled: true, loaded: isLoaded, signedIn: !!isSignedIn, clerkImage: user?.hasImage ? user.imageUrl : '', getToken: () => getToken() }),
    [isLoaded, isSignedIn, getToken, user?.hasImage, user?.imageUrl],
  )
  useEffect(() => {
    tokenSource = () => getToken()
  }, [getToken])
  const refresh = useAccount((s) => s.refresh)
  const clear = useAccount((s) => s.clear)
  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) void refresh()
    else clear()
  }, [isLoaded, isSignedIn, user?.id, refresh, clear])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// --------------------------------------------------------------------------- the server

/** Calls the WorldTour server with the signed-in user's Clerk token. */
export async function server<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  if (!SERVER_URL) throw new ServerError('Accounts are not set up on this site yet.', 503)
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.auth !== false) {
    const token = await tokenSource().catch(() => null)
    if (!token) throw new ServerError('Please sign in to continue.', 401)
    headers.Authorization = `Bearer ${token}`
  }
  let response: Response
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    })
  } catch {
    throw new ServerError("Couldn't reach WorldTour. Check your connection and try again.", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ServerError(data?.error || `Request failed (${response.status}).`, response.status)
  return data as T
}

// --------------------------------------------------------------------------- the profile

interface AccountState {
  profile: Profile | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  update: (changes: Partial<Omit<Profile, 'preferences'>> & { preferences?: Partial<Preferences> }) => Promise<Profile>
  setProfile: (profile: Profile) => void
  clear: () => void
}

const PROFILE_KEY = 'wt-profile'
function cachedProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null')
  } catch {
    return null
  }
}

export const useAccount = create<AccountState>((set) => ({
  profile: cachedProfile(),
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const { user } = await server<{ user: Profile }>('/api/me')
      set({ profile: user, loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Could not load your profile.' })
    }
  },
  update: async (changes) => {
    const { user } = await server<{ user: Profile }>('/api/me', { method: 'PATCH', body: changes })
    set({ profile: user })
    return user
  },
  setProfile: (profile) => set({ profile }),
  clear: () => set({ profile: null, loading: false, error: null }),
}))

useAccount.subscribe((state, previous) => {
  if (state.profile === previous.profile) return
  try {
    if (state.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile))
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* only a speed-up */
  }
})

// The chat uses the saved home city and currency as defaults (see ai/ ChatBody).
useAccount.subscribe((state) => {
  const prefs = state.profile?.preferences
  setChatDefaults(prefs ? { home_city: prefs.homeCity || undefined, currency: prefs.currency || undefined } : {})
})

/** Initials for an avatar without a photo. */
export function initials(name: string | undefined, email?: string): string {
  const source = (name || email || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase()
}
