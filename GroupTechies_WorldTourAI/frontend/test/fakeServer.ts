// A fake WorldTour accounts server behind fetch, with the same rules as the Express routes: the user comes from the
// bearer token only, only finished itineraries are saved, a draft key makes saving idempotent, and users are kept apart.
export interface Call {
  method: string
  path: string
  auth: string | null
  body: any
}

export function createFakeServer() {
  const calls: Call[] = []
  const profiles: Record<string, any> = {}
  const trips: any[] = []
  const state = { down: false, failNext: 0, failStatus: 500, rejectToken: false, seq: 0 }
  const userOf = (auth: string | null) => (auth?.startsWith('Bearer tok-') && !state.rejectToken ? `user_${auth.slice('Bearer tok-'.length)}` : null)
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const detail = (t: any) => ({ ...summary(t), plan: t.versions.at(-1)?.plan ?? null, messages: t.messages, session: t.session, selection: t.selection, notes: '', versionList: t.versions.map((v: any, i: number) => ({ id: `v${i}`, number: i + 1, prompt: '', estimatedCost: null, currency: '', createdAt: t.createdAt })), share: { enabled: false, url: null } })
  const summary = (t: any) => {
    const p = t.versions.at(-1)?.plan ?? {}
    return {
      id: t.id, title: t.title, firstPrompt: t.firstPrompt, origin: p.origin ?? '', destination: p.destination ?? '', cities: p.cities ?? [], durationDays: p.duration?.days ?? null,
      startDate: p.dates?.start_date ?? '', endDate: p.dates?.end_date ?? '', budget: p.budget?.user_stated ? p.budget.amount : null, budgetCurrency: p.budget?.currency ?? '', preferences: p.preferences ?? [],
      travelers: p.travelers ?? null, estimatedCost: p.estimated_cost ?? null, currency: p.display_currency ?? '', status: 'planned', favorite: false, versions: t.versions.length, messages: t.messages.length,
      shared: false, lastPlannedAt: t.createdAt, createdAt: t.createdAt, updatedAt: t.createdAt,
    }
  }

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    if (url.host !== 'api.test') return json(404, {}) // wikipedia photos etc.
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const auth = headers.Authorization ?? null
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url.pathname + url.search, auth, body })
    if (state.down) throw new TypeError('Failed to fetch')
    const user = userOf(auth)
    if (!user) return json(401, { error: auth ? "We couldn't verify your sign-in. Refresh the page; if it keeps happening, sign out and back in." : 'Please sign in to continue.' })
    const path = url.pathname
    if (path === '/api/me') {
      profiles[user] ??= { id: user, fullName: `${user.slice(5)} Traveler`, email: `${user.slice(5)}@example.com`, phone: '', photoUrl: '', onboarded: true, preferences: { homeCity: '', currency: '', language: 'en', theme: 'system', readAloud: false }, memberSince: '2026-01-01T00:00:00Z' }
      if (method === 'PATCH') {
        const { preferences, ...rest } = body
        profiles[user] = { ...profiles[user], ...rest, preferences: { ...profiles[user].preferences, ...(preferences ?? {}) } }
      }
      return json(200, { user: profiles[user], photos: false })
    }
    if (path === '/api/stats') return json(200, { stats: { trips: 0, planned: 0, favorites: 0, plansGenerated: 0, prompts: 0, daysPlanned: 0, destinations: 0, topDestination: null, budgetPlanned: [] }, recent: [] })
    if (path === '/api/trips' && method === 'POST') {
      if (state.failNext > 0) {
        state.failNext -= 1
        return json(state.failStatus, { error: 'Something went wrong on our side. Please try again.' })
      }
      if (!Array.isArray(body?.plan?.daily_itinerary) || !body.plan.daily_itinerary.length) return json(400, { error: 'Only a finished itinerary can be saved to My trips.' })
      const existing = body.clientId && trips.find((t) => t.owner === user && t.clientId === body.clientId)
      if (existing) {
        existing.versions.push({ plan: body.plan })
        return json(200, { trip: detail(existing) })
      }
      const trip = { id: `t${++state.seq}`, owner: user, clientId: body.clientId, title: `${body.plan.destination} · ${body.plan.duration?.days} days`, firstPrompt: body.messages?.[0]?.content ?? '', messages: body.messages ?? [], session: body.session, selection: body.selection, createdAt: '2026-11-01T10:00:00Z', versions: [{ plan: body.plan }] }
      trips.push(trip)
      return json(201, { trip: detail(trip) })
    }
    if (path === '/api/trips' && method === 'GET') {
      const mine = trips.filter((t) => t.owner === user)
      return json(200, { trips: mine.map(summary), total: mine.length, page: 1, pages: 1 })
    }
    const one = path.match(/^\/api\/trips\/([^/]+)(\/sync)?$/)
    if (one) {
      const trip = trips.find((t) => t.id === one[1] && t.owner === user)
      if (!trip) return json(404, { error: 'Trip not found.' })
      if (method === 'DELETE') {
        trips.splice(trips.indexOf(trip), 1)
        return json(200, { deleted: true })
      }
      if (method === 'PUT') {
        if (body.plan && JSON.stringify(trip.versions.at(-1).plan) !== JSON.stringify(body.plan)) trip.versions.push({ plan: body.plan })
        return json(200, { trip: summary(trip) })
      }
      return json(200, { trip: detail(trip) })
    }
    return json(404, { error: 'Not found.' })
  }
  return { handler, calls, profiles, trips, state, calls_to: (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix)) }
}
