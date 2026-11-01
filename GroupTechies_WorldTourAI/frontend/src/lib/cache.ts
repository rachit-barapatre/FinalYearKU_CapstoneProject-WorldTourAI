import { useCallback, useEffect, useState } from 'react'
import { server, useAccount } from './account'

/**
 * A small stale-while-revalidate cache for the accounts server. A page that was opened (or
 * prefetched from the menu) before shows its last data at once and refreshes in the background,
 * so moving between Profile, My trips and a trip feels instant.
 */

const store = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()
const listeners = new Map<string, Set<() => void>>()

function emit(path: string) {
  listeners.get(path)?.forEach((fn) => fn())
}

export function peek<T>(path: string): T | undefined {
  return store.get(path) as T | undefined
}

export function setCached<T>(path: string, data: T | ((current: T | undefined) => T)) {
  const next = typeof data === 'function' ? (data as (c: T | undefined) => T)(store.get(path) as T | undefined) : data
  store.set(path, next)
  emit(path)
}

/** Fetch once even if several components ask at the same time. */
export function load<T>(path: string): Promise<T> {
  const running = inflight.get(path)
  if (running) return running as Promise<T>
  const request = server<T>(path)
    .then((data) => {
      store.set(path, data)
      emit(path)
      return data
    })
    .finally(() => inflight.delete(path))
  inflight.set(path, request)
  return request
}

/** Warm the cache (menu hover, idle time after sign-in). Errors are ignored here. */
export function prefetch(path: string) {
  if (!inflight.has(path)) void load(path).catch(() => undefined)
}

/** Drop cached answers whose path starts with prefix (after a change, e.g. '/api/trips'). */
export function invalidate(prefix: string) {
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key)
}

// Another person signing in on this browser must never see the previous account's data.
useAccount.subscribe((state, previous) => {
  if (!state.profile && previous.profile) store.clear()
})

export function useServerData<T>(path: string | null) {
  const [, force] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!path) return
    const rerender = () => force((n) => n + 1)
    const set = listeners.get(path) ?? new Set()
    set.add(rerender)
    listeners.set(path, set)
    return () => {
      set.delete(rerender)
    }
  }, [path])

  const reload = useCallback(() => {
    if (!path) return
    setError(null)
    setLoading(true)
    load<T>(path)
      .catch((e) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => setLoading(false))
  }, [path])

  useEffect(reload, [reload])

  return {
    data: path ? peek<T>(path) : undefined,
    error,
    loading,
    reload,
    mutate: (next: T | ((current: T | undefined) => T)) => path && setCached(path, next),
  }
}

/** The first page of My trips with the default filters (shared by the page and the menu prefetch). */
export function tripsPath({ sort = 'recent', page = 1, search = '', filter = 'active' }: { sort?: string; page?: number; search?: string; filter?: string } = {}) {
  const params = new URLSearchParams({ sort, page: String(page), limit: '12' })
  if (search) params.set('search', search)
  if (filter === 'favorite') params.set('favorite', 'true')
  params.set('status', filter === 'favorite' ? 'active' : filter)
  return `/api/trips?${params}`
}
