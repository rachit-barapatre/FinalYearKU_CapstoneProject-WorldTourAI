// What the planner shows about saving the finished itinerary to My trips: saving, saved (with the trip's id) or an error with a retry.
import { create } from 'zustand'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface SaveStatus {
  state: SaveState
  message: string
  tripId: string | null
  /** Bumped by "Try again": the sync effect watches it and sends the itinerary again. */
  retryTick: number
  saving: () => void
  saved: (tripId: string | null) => void
  failed: (message: string) => void
  idle: () => void
  retry: () => void
}

export const useSaveStatus = create<SaveStatus>((set) => ({
  state: 'idle',
  message: '',
  tripId: null,
  retryTick: 0,
  saving: () => set({ state: 'saving', message: '' }),
  saved: (tripId) => set({ state: 'saved', message: '', tripId }),
  failed: (message) => set({ state: 'error', message }),
  idle: () => set({ state: 'idle', message: '', tripId: null }),
  retry: () => set((s) => ({ state: 'saving', message: '', retryTick: s.retryTick + 1 })),
}))
