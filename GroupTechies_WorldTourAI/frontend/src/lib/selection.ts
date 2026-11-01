// Re-costing the trip in the browser when the traveler picks another package, flight, train or hotel.
//
// The plan from the API is the base and is never changed. A Selection says which options the traveler
// chose; applySelection() returns a new plan with the transport, hotels, day-1 arrival and last-day
// departure, local transport and cost breakdown updated. Everything else in the itinerary stays as it was,
// so switching options never reshuffles the days. The arrival and departure blocks follow the same rules
// as the planner's itinerary composer (ai/src/worldtour_ai/services/itinerary_composer.py).

import type { Activity, BreakdownRow, Flight, GroundOption, ItineraryDay, Package, Plan, Pricing, TransportChoice } from './types'

export type TransportPick = { kind: 'flight'; outbound: string; ret: string | null } | { kind: 'ground'; id: string }

export interface Selection {
  /** Package whose food level applies; null once the traveler mixes options from different packages. */
  package: Package['name'] | null
  transport: TransportPick | null
  /** Chosen hotel per city (city name, or '' when the hotel has no city). */
  hotels: Record<string, string>
}

const FLIGHT_OVERHEAD_MIN = 210
const AIRPORT_LEAD = 180
const STATION_LEAD = 60
const START_IDS = new Set(['flight:outbound', 'ground:outbound', 'transfer:airport-hotel', 'transfer:station-hotel'])
const END_IDS = new Set(['transfer:airport', 'flight:return', 'transfer:station', 'ground:return'])
const NOT_SIGHTS = new Set(['travel', 'transfer', 'meal', 'stay', 'free'])

// --------------------------------------------------------------------------- selections

export function pricingOf(plan: Plan): Pricing {
  const travelers = plan.pricing?.travelers ?? plan.travelers ?? 1
  return (
    plan.pricing ?? {
      travelers,
      rooms: Math.max(1, Math.ceil(travelers / 2)),
      nights: plan.duration.nights,
      intercity_cost: plan.budget_breakdown.find((row) => row.category === 'Travel between cities')?.cost ?? 0,
      country: null,
      local_rates: { name: 'taxi or rideshare', base: 3, per_km: 1.2 },
      airport_km: 20,
      station_km: 8,
    }
  )
}

function pickFromChoice(plan: Plan, choice: TransportChoice | null | undefined): TransportPick | null {
  if (!choice) return null
  if (choice.kind === 'flight') {
    const outbound = choice.outbound_id ?? plan.recommended_outbound_id ?? plan.selected_flights[0]?.option_id
    if (!outbound) return null
    return { kind: 'flight', outbound, ret: choice.return_id ?? plan.recommended_return_id ?? plan.return_flights[0]?.option_id ?? null }
  }
  return choice.option_id ? { kind: 'ground', id: choice.option_id } : null
}

export function packageSelection(plan: Plan, pkg: Package): Selection {
  return {
    package: pkg.name,
    transport: pickFromChoice(plan, pkg.transport),
    hotels: Object.fromEntries(pkg.hotels.map((hotel) => [hotel.city ?? '', hotel.option_id])),
  }
}

/** What the planner recommended. */
export function initialSelection(plan: Plan): Selection {
  const pkg = plan.packages.find((p) => p.name === plan.recommended_package)
  if (pkg) return { ...packageSelection(plan, pkg), transport: pickFromChoice(plan, plan.transport_choice) }
  const hotels: Record<string, string> = {}
  for (const hotel of plan.selected_hotels) {
    if (plan.recommended_hotel_ids.includes(hotel.option_id)) hotels[hotel.city ?? ''] = hotel.option_id
  }
  return { package: null, transport: pickFromChoice(plan, plan.transport_choice), hotels }
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return a.package === b.package && sameTransport(a.transport, b.transport) && sameHotels(a.hotels, b.hotels)
}

function sameTransport(a: TransportPick | null, b: TransportPick | null): boolean {
  if (!a || !b) return a === b
  if (a.kind === 'ground' || b.kind === 'ground') return a.kind === b.kind && (a as { id: string }).id === (b as { id: string }).id
  return a.outbound === b.outbound && a.ret === b.ret
}

function sameHotels(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => a[key] === b[key])
}

/** The package whose options match the selection exactly, if any. */
export function matchingPackage(plan: Plan, selection: Selection): Package['name'] | null {
  // Two packages can share the same travel and hotels (they then differ only in food level):
  // the one the traveler chose wins.
  const ordered = [...plan.packages].sort((a, b) => Number(b.name === selection.package) - Number(a.name === selection.package))
  for (const pkg of ordered) {
    const own = packageSelection(plan, pkg)
    if (sameTransport(own.transport, selection.transport) && sameHotels(own.hotels, selection.hotels)) return pkg.name
  }
  return null
}

// --------------------------------------------------------------------------- transport

export function transportFor(plan: Plan, pick: TransportPick | null): TransportChoice | null {
  if (!pick) return null
  const travelers = pricingOf(plan).travelers
  if (pick.kind === 'flight') {
    const outbound = plan.selected_flights.find((f) => f.option_id === pick.outbound)
    if (!outbound) return null
    const inbound = pick.ret ? plan.return_flights.find((f) => f.option_id === pick.ret) ?? null : null
    const legs = [`${outbound.airline || 'Flight'} ${outbound.flight_number || ''}`.trim()]
    if (inbound) legs.push(`${inbound.airline || ''} ${inbound.flight_number || ''}`.trim())
    return {
      kind: 'flight',
      label: `Flight (${legs.join(' / ')})`,
      outbound_id: outbound.option_id,
      return_id: inbound?.option_id ?? null,
      round_trip_total: round2(flightFare(outbound, inbound) * travelers),
      door_to_door_minutes: (outbound.duration_minutes ?? 0) + FLIGHT_OVERHEAD_MIN,
      duration_minutes: outbound.duration_minutes,
      price_is_estimate: !!outbound.price_is_estimate,
      booking_link: null,
    }
  }
  const option = plan.ground_options.find((o) => o.option_id === pick.id)
  if (!option) return null
  return {
    kind: option.kind,
    label: option.label,
    option_id: option.option_id,
    round_trip_total: round2(2 * groundOneWay(option, travelers)),
    door_to_door_minutes: option.duration_minutes + (option.kind === 'cab' ? 0 : 60),
    duration_minutes: option.duration_minutes,
    price_is_estimate: true,
    booking_link: option.booking_link ?? null,
  }
}

/** Per person, both ways. A round-trip fare is quoted on the outbound flight only. */
export function flightFare(outbound: Flight, inbound: Flight | null): number {
  return (outbound.price ?? 0) + (inbound && !inbound.price_included ? inbound.price ?? 0 : 0)
}

export function groundOneWay(option: GroundOption, travelers: number): number {
  return option.price_total_one_way ?? option.price_pp * travelers
}

// --------------------------------------------------------------------------- itinerary

function localLeg(km: number, pricing: Pricing) {
  if (km <= 1) return { mode: 'walk', label: 'Walk', distance_km: round1(km), minutes: Math.max(5, Math.ceil((km / 4.5) * 60)), cost_usd: 0 }
  const road = km * 1.3
  const vehicles = Math.ceil(Math.max(pricing.travelers, 1) / 4)
  const speed = road < 10 ? 22 : road < 25 ? 30 : 38
  const name = pricing.local_rates.name
  return {
    mode: 'cab',
    label: name.charAt(0).toUpperCase() + name.slice(1),
    distance_km: round1(road),
    minutes: Math.ceil((road / speed) * 60 + 6),
    cost_usd: round2((pricing.local_rates.base + road * pricing.local_rates.per_km) * vehicles),
  }
}

function entry(id: string, start: number, end: number, category: string, name: string, detail: string, cost: number | null = null, mode: string | null = null): Activity {
  return { activity_id: id, start_minute: start, end_minute: Math.max(end, start + 5), category, name, detail, cost_usd: cost, mode, lat: null, lon: null }
}

function legDetail(leg: ReturnType<typeof localLeg>): string {
  return `${leg.label} · ~${leg.distance_km} km · ${leg.minutes} min · {money:${leg.cost_usd.toFixed(2)}}`
}

function transferToHotel(at: number, km: number, place: string, pricing: Pricing): Activity[] {
  const leg = localLeg(km, pricing)
  const end = at + leg.minutes
  return [
    entry(`transfer:${place}-hotel`, at, end, 'transfer', `Cab from the ${place} to the hotel`, legDetail(leg), leg.cost_usd, leg.mode),
    entry('stay:checkin', end, end + 30, 'stay', end >= 14 * 60 ? 'Check in at the hotel' : 'Drop bags at the hotel (check-in is usually from 14:00)', ''),
  ]
}

function clockFromIso(value: string | null | undefined): number | null {
  if (!value || !String(value).includes('T')) return null
  const [h, m] = String(value).split('T')[1].slice(0, 5).split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

const hhmm = (minute: number) => {
  const m = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Arrival blocks (day 1) and departure blocks (last day) for the chosen way there and back. */
function endpointBlocks(plan: Plan, pick: TransportPick | null, pricing: Pricing): { start: Activity[]; end: Activity[] } {
  const origin = plan.origin || 'home'
  const destination = plan.daily_itinerary[0]?.city || plan.destination || 'destination'
  if (!pick) return { start: [], end: [] }
  if (pick.kind === 'flight') {
    const outbound = plan.selected_flights.find((f) => f.option_id === pick.outbound)
    const inbound = pick.ret ? plan.return_flights.find((f) => f.option_id === pick.ret) : undefined
    const start: Activity[] = []
    const end: Activity[] = []
    if (outbound) {
      const arrive = clockFromIso(outbound.arrival_time) ?? 11 * 60
      const depart = clockFromIso(outbound.departure_time)
      const flightStart = depart != null && depart < arrive ? depart : Math.max(arrive - (outbound.duration_minutes || 120), 0)
      start.push(
        entry('flight:outbound', flightStart, arrive, 'travel', `Flight ${outbound.origin} → ${outbound.destination}`, `${outbound.airline || ''} ${outbound.flight_number || ''}`.trim(), null, 'flight'),
        ...transferToHotel(arrive + 30, pricing.airport_km, 'airport', pricing),
      )
    }
    if (inbound) {
      const leaveFlight = clockFromIso(inbound.departure_time) ?? 18 * 60
      const leave = Math.max(leaveFlight - AIRPORT_LEAD, 0)
      const leg = localLeg(pricing.airport_km, pricing)
      end.push(
        entry('transfer:airport', leave, leave + leg.minutes, 'transfer', 'Check out and take a cab to the airport', `${legDetail(leg)}. Be at the airport 2–3 hours before departure.`, leg.cost_usd, leg.mode),
        entry('flight:return', leaveFlight, Math.min(leaveFlight + (inbound.duration_minutes || 120), 24 * 60), 'travel', `Flight ${inbound.origin} → ${inbound.destination}`, `${inbound.airline || ''} ${inbound.flight_number || ''}`.trim(), null, 'flight'),
      )
    }
    return { start, end }
  }
  const option = plan.ground_options.find((o) => o.option_id === pick.id)
  if (!option) return { start: [], end: [] }
  const kind = option.kind
  const duration = option.duration_minutes || 360
  const overnight = duration > 9 * 60 && kind !== 'cab'
  const depart = overnight ? 21 * 60 : kind === 'cab' ? 8 * 60 : 7 * 60
  const arrive = (depart + duration) % (24 * 60)
  const titleOut = `${option.label}: ${origin} → ${destination}`
  const start = [
    overnight
      ? entry('ground:outbound', 0, arrive, 'travel', titleOut, `Overnight; departs ${origin} at ${hhmm(depart)} the evening before day 1.`, null, kind)
      : entry('ground:outbound', depart, arrive, 'travel', titleOut, `About ${Math.floor(duration / 60)} h ${String(duration % 60).padStart(2, '0')} min.`, null, kind),
  ]
  if (kind !== 'cab') start.push(...transferToHotel(arrive + 15, pricing.station_km, 'station', pricing))
  else start.push(entry('stay:checkin', arrive, arrive + 30, 'stay', 'Check in at the hotel', 'The cab drops you at the hotel.'))
  const back = overnight ? 21 * 60 : Math.max(6 * 60, Math.min(16 * 60, 23 * 60 - duration))
  const leave = back - (kind !== 'cab' ? STATION_LEAD : 0)
  const end: Activity[] = []
  if (kind !== 'cab') {
    const leg = localLeg(pricing.station_km, pricing)
    end.push(entry('transfer:station', leave, leave + leg.minutes, 'transfer', 'Check out and take a cab to the station/bus stand', legDetail(leg), leg.cost_usd, 'cab'))
  }
  const note = back + duration >= 24 * 60 ? ' the next day.' : '.'
  end.push(entry('ground:return', back, Math.min(back + duration, 24 * 60), 'travel', `${option.label}: ${destination} → ${origin}`, `Arrives about ${hhmm((back + duration) % (24 * 60))}${note}`, null, kind))
  return { start, end }
}

/** Keeps a transfer only when the stop it leads to is kept. */
function keepWithTransfers(activities: Activity[], keep: (a: Activity) => boolean, keepTrailing: (a: Activity) => boolean): { kept: Activity[]; dropped: Activity[] } {
  const decided = activities.map((a) => (a.category === 'transfer' ? null : keep(a)))
  const kept: Activity[] = []
  const dropped: Activity[] = []
  activities.forEach((activity, index) => {
    let ok = decided[index]
    if (ok === null) {
      const next = decided.slice(index + 1).find((value) => value !== null)
      ok = next === undefined ? keepTrailing(activity) : next && keep(activity)
    }
    if (ok) kept.push(activity)
    else dropped.push(activity)
  })
  return { kept, dropped }
}

function replaceAll(text: string, from: string, to: string): string {
  return from && from !== to ? text.split(from).join(to) : text
}

/** Morning / midday / evening lines from the timetable, as the planner writes them when the AI text is unavailable. */
function describe(day: ItineraryDay): void {
  const buckets: Record<'morning' | 'midday' | 'evening', Activity[]> = { morning: [], midday: [], evening: [] }
  for (const activity of day.activities) {
    if (activity.category === 'transfer') continue
    const slot = activity.start_minute < 12 * 60 ? 'morning' : activity.start_minute < 17 * 60 ? 'midday' : 'evening'
    buckets[slot].push(activity)
  }
  const leaving = day.activities.some((a) => a.activity_id === 'flight:return' || a.activity_id === 'ground:return')
  for (const part of ['morning', 'midday', 'evening'] as const) {
    const text = buckets[part].map((a) => `${hhmm(a.start_minute)}–${hhmm(a.end_minute)}. ${a.name}.${a.detail ? ` ${a.detail}` : ''}`).join(' ')
    day[part] = text || (leaving ? 'On your way home.' : `Free time in ${day.city || 'the city'}.`)
  }
}

function adjustItinerary(plan: Plan, selection: Selection, base: Selection, pricing: Pricing): ItineraryDay[] {
  const days: ItineraryDay[] = plan.daily_itinerary.map((day) => ({ ...day, activities: day.activities.map((a) => ({ ...a })), notes: [] }))
  const hotelsById = new Map(plan.selected_hotels.map((h) => [h.option_id, h]))

  // A different hotel: same days, new name and map pin.
  for (const day of days) {
    const city = day.city ?? ''
    const key = city in selection.hotels ? city : Object.keys(selection.hotels).find((k) => k.toLowerCase() === city.toLowerCase()) ?? city
    const chosen = hotelsById.get(selection.hotels[key])
    const current = day.stay
    if (!chosen || !current || chosen.option_id === current.option_id || chosen.name === current.name) continue
    const from = current.name
    for (const activity of day.activities) {
      activity.name = replaceAll(activity.name, from, chosen.name)
      activity.detail = replaceAll(activity.detail, from, chosen.name)
    }
    for (const part of ['morning', 'midday', 'evening'] as const) day[part] = replaceAll(day[part], from, chosen.name)
    if (day.stay_name && day.stay_name !== '—') day.stay_name = chosen.name
    day.stay = { name: chosen.name, option_id: chosen.option_id, lat: chosen.lat ?? null, lon: chosen.lon ?? null }
  }

  // A different way there and back: new arrival and departure blocks; sights that no longer fit are listed.
  if (!sameTransport(selection.transport, base.transport) && days.length) {
    const blocks = endpointBlocks(plan, selection.transport, pricing)
    const first = days[0]
    const last = days[days.length - 1]
    const isStart = (a: Activity, index: number, list: Activity[]) =>
      START_IDS.has(a.activity_id) || (a.activity_id === 'stay:checkin' && list.slice(0, index).some((b) => START_IDS.has(b.activity_id)))

    if (blocks.start.length) {
      const rest = first.activities.filter((a, i, list) => !isStart(a, i, list) && !(first === last && END_IDS.has(a.activity_id)))
      const free = Math.max(...blocks.start.map((a) => a.end_minute)) + 15
      const { kept, dropped } = keepWithTransfers(rest, (a) => a.start_minute >= free, (a) => a.start_minute >= free)
      const ends = first === last ? first.activities.filter((a) => END_IDS.has(a.activity_id)) : []
      first.activities = [...blocks.start, ...kept, ...ends]
      noteDropped(first, dropped, 'arrives later')
      addFreeTime(first, free, kept[0]?.start_minute ?? 21 * 60, 'Free time to rest after the journey or explore near your hotel')
    }
    if (blocks.end.length) {
      const rest = last.activities.filter((a) => !END_IDS.has(a.activity_id))
      const leave = Math.min(...blocks.end.map((a) => a.start_minute))
      const { kept, dropped } = keepWithTransfers(rest, (a) => a.end_minute <= leave - 15 || START_IDS.has(a.activity_id) || a.activity_id === 'stay:checkin', (a) => a.end_minute <= leave)
      last.activities = [...kept, ...blocks.end]
      noteDropped(last, dropped, 'leaves earlier')
      const lastEnd = Math.max(0, ...kept.filter((a) => a.category !== 'transfer').map((a) => a.end_minute))
      addFreeTime(last, lastEnd || 9 * 60, leave, 'Free time before you leave — last-minute shopping or a café nearby')
    }
    for (const day of new Set([first, last])) {
      day.activities.sort((a, b) => a.start_minute - b.start_minute)
      describe(day)
    }
  }

  for (const day of days) {
    day.local_transport_usd = round2(day.activities.reduce((sum, a) => sum + (a.category === 'transfer' ? a.cost_usd ?? 0 : 0), 0))
    if (!day.notes?.length) delete day.notes
  }
  return days
}

function noteDropped(day: ItineraryDay, dropped: Activity[], why: string) {
  const sights = dropped.filter((a) => !NOT_SIGHTS.has(a.category)).map((a) => a.name.replace(/^Dinner at /, ''))
  if (sights.length) day.notes = [...(day.notes ?? []), `With this travel option the day ${why}, so ${sights.join(', ')} ${sights.length > 1 ? 'no longer fit' : 'no longer fits'}.`]
}

function addFreeTime(day: ItineraryDay, from: number, until: number, text: string) {
  if (until - from >= 120) day.activities.push(entry(`free:${from}`, from, until - 15, 'free', text, ''))
}

// --------------------------------------------------------------------------- costs

interface Costs {
  transport: TransportChoice | null
  hotelCost: number
  hotelNames: string[]
  food: number
  local: number
  paid: number
  intercity: number
  total: number
}

function foodFor(plan: Plan, name: Package['name'] | null): number {
  const pkg = plan.packages.find((p) => p.name === name) ?? plan.packages.find((p) => p.name === plan.recommended_package)
  return pkg?.food_cost ?? plan.budget_breakdown.find((row) => row.category === 'Food')?.cost ?? 0
}

function costsFor(plan: Plan, selection: Selection, days: ItineraryDay[], pricing: Pricing): Costs {
  const transport = transportFor(plan, selection.transport)
  const nightsByCity = new Map<string, { nights: number; rooms: number }>()
  const reference = plan.packages.find((p) => p.name === plan.recommended_package) ?? plan.packages[0]
  for (const hotel of reference?.hotels ?? []) nightsByCity.set(hotel.city ?? '', { nights: hotel.nights, rooms: hotel.rooms ?? pricing.rooms })
  let hotelCost = 0
  const hotelNames: string[] = []
  for (const [city, id] of Object.entries(selection.hotels)) {
    const hotel = plan.selected_hotels.find((h) => h.option_id === id)
    if (!hotel) continue
    const stay = nightsByCity.get(city) ?? { nights: pricing.nights ?? 1, rooms: pricing.rooms }
    hotelCost += (hotel.price_per_night ?? 0) * stay.nights * stay.rooms
    hotelNames.push(hotel.name)
  }
  const food = foodFor(plan, selection.package)
  const local = round2(days.reduce((sum, day) => sum + (day.local_transport_usd ?? 0), 0))
  const paid = plan.budget_breakdown.find((row) => row.category === 'Paid activities')?.cost ?? 0
  const intercity = pricing.intercity_cost
  const total = round2((transport?.round_trip_total ?? 0) + intercity + hotelCost + food + local + paid)
  return { transport, hotelCost: round2(hotelCost), hotelNames, food: round2(food), local, paid, intercity, total }
}

function breakdown(plan: Plan, selection: Selection, costs: Costs, pricing: Pricing): BreakdownRow[] {
  const days = plan.duration.days || plan.daily_itinerary.length || 1
  const t = costs.transport
  const live = plan.data_notes.some((note) => note.startsWith('Flight fares are live'))
  const travel = !t
    ? 'not included (no option chosen)'
    : t.kind === 'flight'
      ? `${t.label}, ${pricing.travelers} traveler(s), ${live && !t.price_is_estimate ? 'live round-trip fare' : 'estimated fares'}`
      : `${t.label}, both ways, ${pricing.travelers} traveler(s), estimated fare`
  const label = plan.packages.find((p) => p.name === selection.package)?.label
  const rows: BreakdownRow[] = [
    { category: 'Getting there & back', cost: t?.round_trip_total ?? 0, detail: travel },
    {
      category: 'Accommodation',
      cost: costs.hotelCost,
      detail: `${costs.hotelNames.join(', ') || 'no hotel chosen'}; ${pricing.nights ?? plan.duration.nights ?? '?'} night(s), ${pricing.rooms} room(s)`,
    },
    {
      category: 'Food',
      cost: costs.food,
      detail: `about {money:${(costs.food / Math.max(pricing.travelers * days, 1)).toFixed(2)}} per person per day x ${days} day(s)${label ? `, ${label} level` : ''}`,
    },
    { category: 'Local transport', cost: costs.local, detail: 'every cab ride in the timetable, incl. airport/station transfers' },
    plan.budget_breakdown.find((row) => row.category === 'Paid activities') ?? { category: 'Paid activities', cost: costs.paid },
  ]
  const intercity = plan.budget_breakdown.find((row) => row.category === 'Travel between cities')
  if (intercity) rows.splice(1, 0, intercity)
  return rows
}

function hotelLinks(plan: Plan, selection: Selection, pricing: Pricing) {
  const reference = plan.packages.find((p) => p.name === plan.recommended_package) ?? plan.packages[0]
  let checkin = plan.dates.start_date
  return Object.entries(selection.hotels).flatMap(([city, id]) => {
    const hotel = plan.selected_hotels.find((h) => h.option_id === id)
    if (!hotel) return []
    const nights = reference?.hotels.find((h) => (h.city ?? '') === city)?.nights ?? pricing.nights ?? 1
    const params = new URLSearchParams({
      ss: [hotel.name, hotel.city].filter(Boolean).join(', '),
      group_adults: String(pricing.travelers),
      no_rooms: String(pricing.rooms),
      selected_currency: plan.display_currency || 'USD',
    })
    if (checkin) {
      const out = new Date(`${checkin}T00:00:00Z`)
      out.setUTCDate(out.getUTCDate() + nights)
      const checkout = out.toISOString().slice(0, 10)
      params.set('checkin', checkin)
      params.set('checkout', checkout)
      checkin = checkout
    }
    return [{ name: hotel.name, url: `https://www.booking.com/searchresults.html?${params.toString().replace(/\+/g, '%20')}` }]
  })
}

// --------------------------------------------------------------------------- the active plan

function build(plan: Plan, selection: Selection, base: Selection, pricing: Pricing) {
  const days = adjustItinerary(plan, selection, base, pricing)
  return { days, costs: costsFor(plan, selection, days, pricing) }
}

/** The plan with the traveler's choices applied. Pass null to get the planner's recommendation. */
export function applySelection(plan: Plan, chosen: Selection | null): Plan {
  if (!plan.daily_itinerary || !plan.packages) return plan
  const pricing = pricingOf(plan)
  const base = initialSelection(plan)
  const selection = chosen ?? base
  const budget = plan.budget.planning_budget
  // Every package priced on the same itinerary, so the card totals match what switching gives.
  const packages = plan.packages.map((pkg) => {
    const own = packageSelection(plan, pkg)
    // The recommended package keeps the planner's exact total.
    const total = pkg.name === base.package && sameTransport(own.transport, base.transport) ? plan.estimated_cost : build(plan, own, base, pricing).costs.total
    return { ...pkg, total, fits_budget: budget == null || total <= budget }
  })
  if (sameSelection(selection, base)) return { ...plan, packages }
  const { days, costs } = build(plan, selection, base, pricing)
  const ground = costs.transport && costs.transport.kind !== 'flight' && costs.transport.booking_link ? { label: costs.transport.label, url: costs.transport.booking_link } : undefined
  return {
    ...plan,
    packages,
    recommended_package: matchingPackage(plan, selection) ?? selection.package ?? null,
    transport_choice: costs.transport,
    recommended_outbound_id: selection.transport?.kind === 'flight' ? selection.transport.outbound : plan.recommended_outbound_id,
    recommended_return_id: selection.transport?.kind === 'flight' ? selection.transport.ret : plan.recommended_return_id,
    recommended_hotel_ids: Object.values(selection.hotels),
    daily_itinerary: days,
    budget_breakdown: breakdown(plan, selection, costs, pricing),
    estimated_cost: costs.total,
    remaining_budget: budget == null ? null : round2(budget - costs.total),
    links: { ...plan.links, ground, hotels: hotelLinks(plan, selection, pricing) },
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
