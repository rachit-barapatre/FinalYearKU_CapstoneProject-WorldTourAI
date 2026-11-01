import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ApiError, runPlan, sendChat } from './lib/api'
import { packageLabel, t, type Lang } from './lib/i18n'
import { formatMoney } from './lib/money'
import { applySelection, initialSelection, packageSelection, type Selection, type TransportPick } from './lib/selection'
import type { AgentEvent, ChatMessage, Package, Plan, Session, Summary } from './lib/types'

type Status = 'idle' | 'thinking' | 'planning'

interface State {
  messages: ChatMessage[]
  session: Session | null
  summary: Summary | null
  plan: Plan | null
  /** The traveler's own picks on top of the plan; null means the planner's recommendation. */
  selection: Selection | null
  events: AgentEvent[]
  status: Status
  notice: string | null
  error: string | null
  accessCode: string | null
  /** The saved trip (server) this conversation belongs to; null until it is saved. */
  tripId: string | null
  setTripId: (id: string | null) => void
  /** Open a saved trip in the planner to continue it. */
  loadTrip: (trip: { id: string; messages: ChatMessage[]; session: Session | null; plan: Plan | null; selection: Selection | null }) => void
  /** Chat language; the assistant replies in it and voice input listens for it. */
  language: Lang
  setLanguage: (language: Lang) => void
  needsAccessCode: boolean
  /** shown: what the chat displays when it differs from what is sent (e.g. a translated chip label). */
  send: (text: string, shown?: string) => Promise<void>
  /** Re-sends the last unanswered message, or restarts planning. */
  retry: () => Promise<void>
  reset: () => void
  setAccessCode: (code: string) => void
  setNeedsAccessCode: (value: boolean) => void
  dismissError: () => void
  choosePackage: (name: Package['name'], announce?: boolean) => void
  chooseTransport: (pick: TransportPick) => void
  chooseHotel: (city: string, id: string) => void
  resetSelection: () => void
}

/** "by train", "go by flight" … switched in the browser when the plan already has that option. */
const MODE_REQUEST = /^(?:please\s+)?(?:(?:i\s+want\s+to\s+)?(?:go|travel)\s+)?(?:switch\s+to\s+|change\s+to\s+)?(?:by|via|take\s+(?:a|the))\s+(train|rail|flight|plane|air|bus|cab)[.!]?$/i

function pickForMode(plan: Plan, mode: string): TransportPick | null {
  if (mode === 'flight') {
    const outbound = plan.recommended_outbound_id ?? plan.selected_flights.find((f) => f.price != null)?.option_id
    if (!outbound || !plan.selected_flights.length) return null
    return { kind: 'flight', outbound, ret: plan.recommended_return_id ?? plan.return_flights[0]?.option_id ?? null }
  }
  const options = plan.ground_options.filter((o) => o.kind === mode).sort((a, b) => a.price_pp - b.price_pp)
  if (!options.length) return null
  // A mid-priced train (e.g. 3AC rather than Sleeper) is the usual comfortable default.
  const option = mode === 'train' ? options[Math.floor((options.length - 1) / 2)] : options[0]
  return { kind: 'ground', id: option.option_id }
}

/** "premium", "switch to budget", "the balanced package" … handled in the browser, without re-planning. */
const PACKAGE_REQUEST = /^(?:please\s+)?(?:switch\s+to\s+|change\s+to\s+|go\s+with\s+|use\s+|make\s+it\s+)?(?:the\s+)?(budget|balanced|premium|luxury|cheaper|cheapest)(?:\s+(?:package|option|plan|one))?[.!]?$/i

const now = () => new Date().toISOString()

export const WELCOME: ChatMessage = {
  role: 'assistant',
  content:
    "Hi, I'm your WorldTour travel assistant. Tell me where you'd like to go, from where, for how long, your budget and who's coming.\n\n" +
    "I'll ask for anything missing, check the trip is realistic, then plan transport, hotels, weather and an hour-by-hour itinerary.",
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const plan = async (session: Session) => {
        set({ status: 'planning', events: [], notice: null })
        const result = await runPlan(
          session,
          get().accessCode,
          (event) => set((s) => ({ events: [...s.events, event] })),
          () => set({ events: [], notice: 'The connection dropped — restarting the plan…' }),
        )
        set((s) => ({
          plan: result.plan,
          selection: null,
          session: result.session,
          status: 'idle',
          notice: null,
          messages: [
            ...s.messages,
            {
              role: 'assistant',
              at: now(),
              content: t(get().language, 'planReady'),
            },
          ],
        }))
      }

      const handleError = (error: unknown) => {
        const status = error instanceof ApiError ? error.status : 0
        if (status === 401) set({ needsAccessCode: true })
        set({ status: 'idle', notice: null, error: error instanceof Error ? error.message : 'Something went wrong. Please try again.' })
      }

      return {
        messages: [WELCOME],
        session: null,
        summary: null,
        plan: null,
        selection: null,
        events: [],
        status: 'idle',
        notice: null,
        error: null,
        accessCode: null,
        needsAccessCode: false,
        language: 'en',
        setLanguage: (language) => set({ language }),
        tripId: null,
        setTripId: (tripId) => set({ tripId }),
        loadTrip: (trip) =>
          set({
            tripId: trip.id,
            messages: trip.messages.length ? trip.messages : [WELCOME],
            session: trip.session,
            plan: trip.plan,
            selection: trip.selection,
            summary: null,
            events: [],
            status: 'idle',
            error: null,
            notice: null,
          }),

        send: async (text: string, shown?: string) => {
          const message = text.trim()
          if (!message || get().status !== 'idle') return
          const label = shown?.trim() || message
          const lang = get().language
          const mode = message.match(MODE_REQUEST)?.[1]?.toLowerCase()
          const current = get().plan
          if (mode && current && get().session?.stage === 'planned') {
            const pick = pickForMode(current, mode === 'plane' || mode === 'air' ? 'flight' : mode === 'rail' ? 'train' : mode)
            if (pick) {
              set((s) => ({ messages: [...s.messages.filter((m) => !m.failed), { role: 'user', content: label, at: now() }], error: null }))
              get().chooseTransport(pick)
              const updated = applySelection(current, get().selection)
              const display = { currency: current.display_currency || 'USD', rate: current.usd_to_display || 1 }
              set((s) => ({
                messages: [
                  ...s.messages,
                  {
                    role: 'assistant',
                    at: now(),
                    content: t(lang, 'switchedMode', { travel: updated.transport_choice?.label ?? mode, total: formatMoney(updated.estimated_cost, display) }),
                  },
                ],
              }))
              return
            }
          }
          const asked = message.match(PACKAGE_REQUEST)?.[1]?.toLowerCase()
          if (asked && get().plan && get().session?.stage === 'planned') {
            set((s) => ({ messages: [...s.messages.filter((m) => !m.failed), { role: 'user', content: label, at: now() }], error: null }))
            const name = asked === 'luxury' ? 'premium' : asked.startsWith('cheap') ? 'budget' : (asked as Package['name'])
            get().choosePackage(name, true)
            return
          }
          set((s) => ({
            // A message that failed earlier is replaced by this attempt rather than shown twice.
            messages: [...s.messages.filter((m) => !m.failed), { role: 'user', content: label, at: now() }],
            status: 'thinking',
            error: null,
          }))
          try {
            const response = await sendChat(get().session, message, get().accessCode, lang)
            set((s) => ({
              messages: [...s.messages, { role: 'assistant', content: response.reply, at: now() }],
              session: response.session,
              summary: response.summary ?? s.summary,
            }))
            if (!response.ready) {
              set({ status: 'idle' })
              return
            }
            await plan(response.session)
          } catch (error) {
            // If the chat failed before an answer, keep the message on screen marked as not sent,
            // so the traveler stays in the conversation and can send it again with one tap.
            if (get().status === 'thinking') {
              set((s) => ({
                messages: s.messages.map((m, i) => (i === s.messages.length - 1 && m.role === 'user' ? { ...m, failed: true } : m)),
              }))
            }
            handleError(error)
          }
        },

        retry: async () => {
          const unsent = get().messages.at(-1)
          if (unsent?.role === 'user' && unsent.failed) return get().send(unsent.content)
          const { session } = get()
          if (!session || session.stage !== 'ready' || get().status !== 'idle') return
          set({ error: null })
          try {
            await plan(session)
          } catch (error) {
            handleError(error)
          }
        },

        reset: () =>
          set({ messages: [WELCOME], session: null, summary: null, plan: null, selection: null, tripId: null, events: [], status: 'idle', error: null, notice: null }),
        setAccessCode: (code) => set({ accessCode: code.trim() || null, needsAccessCode: false, error: null }),
        setNeedsAccessCode: (value) => set({ needsAccessCode: value }),
        dismissError: () => set({ error: null }),

        choosePackage: (name, announce = false) => {
          const { plan, session } = get()
          const pkg = plan?.packages.find((p) => p.name === name)
          if (!plan || !pkg) return
          const selection = packageSelection(plan, pkg)
          const updated = applySelection(plan, selection)
          set((s) => ({
            selection,
            // Remember the choice, so a later change in the chat ("5 days") re-plans with this package.
            session: session ? { ...session, request: { ...((session.request as object) ?? {}), package_choice: name } } : session,
            messages: announce
              ? [
                  ...s.messages,
                  {
                    role: 'assistant',
                    at: now(),
                    content: t(get().language, 'switchedPackage', {
                      pkg: packageLabel(get().language, name),
                      travel: updated.transport_choice?.label ?? '—',
                      hotels: pkg.hotels.map((h) => h.name).join(', ') || '—',
                      total: formatMoney(updated.estimated_cost, { currency: plan.display_currency || 'USD', rate: plan.usd_to_display || 1 }),
                    }),
                  },
                ]
              : s.messages,
          }))
        },
        chooseTransport: (pick) => {
          const { plan } = get()
          if (!plan) return
          const current = get().selection ?? initialSelection(plan)
          set({ selection: { ...current, transport: pick, package: current.package } })
        },
        chooseHotel: (city, id) => {
          const { plan } = get()
          if (!plan) return
          const current = get().selection ?? initialSelection(plan)
          set({ selection: { ...current, hotels: { ...current.hotels, [city]: id } } })
        },
        resetSelection: () => set({ selection: null }),
      }
    },
    {
      name: 'worldtour-session',
      version: 2,
      migrate: (state) => state as State,
      // Keep the conversation and plan across reloads, but never resume mid-request.
      partialize: (s) => ({ messages: s.messages, session: s.session, summary: s.summary, plan: s.plan, selection: s.selection, accessCode: s.accessCode, language: s.language, tripId: s.tripId }),
    },
  ),
)

/** True once the traveler has said something (the landing page gives way to the workspace). */
export const useStarted = () => useStore((s) => s.messages.some((m) => m.role === 'user') || !!s.plan)

/** The plan with the traveler's picks applied — what every plan view shows and exports. */
export function useActivePlan(): Plan | null {
  const plan = useStore((s) => s.plan)
  const selection = useStore((s) => s.selection)
  return useMemo(() => (plan ? applySelection(plan, selection) : null), [plan, selection])
}
