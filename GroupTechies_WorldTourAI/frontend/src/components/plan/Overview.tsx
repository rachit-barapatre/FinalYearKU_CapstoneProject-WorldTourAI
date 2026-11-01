import clsx from 'clsx'
import { BedDouble, Bus, Car, Check, CloudSun, Luggage, MapPin, Moon, Package as PackageIcon, Plane, Star, TrainFront } from 'lucide-react'
import { useState } from 'react'
import { clockFromIso, duration, formatMoney, prettyDate, type Display } from '../../lib/money'
import { flightFare, groundOneWay, pricingOf } from '../../lib/selection'
import type { Flight, GroundOption, Hotel, Plan } from '../../lib/types'
import { weatherEmoji } from '../../lib/weather'
import { usePlanAction, usePlanReadOnly } from './readOnly'
import { Badge, Card, ExternalLink, SectionTitle } from '../ui'

export function Overview({ plan, display }: { plan: Plan; display: Display }) {
  return (
    <div className="space-y-4">
      <Packages plan={plan} display={display} />
      <GettingThere plan={plan} display={display} />
      <Hotels plan={plan} display={display} />
      <Weather plan={plan} />
    </div>
  )
}

/** "+₹1,200" / "−₹800" against what is selected now. */
function Delta({ amount, display }: { amount: number; display: Display }) {
  if (Math.abs(amount * (display.rate || 1)) < 1) return <span className="text-xs font-medium text-slate-400">same price</span>
  const more = amount > 0
  return (
    <span className={clsx('text-xs font-semibold tabular-nums', more ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400')}>
      {more ? '+' : '−'}
      {formatMoney(Math.abs(amount), display)}
    </span>
  )
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      className={clsx(
        'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition',
        on ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-400' : 'border-slate-300 dark:border-white/25',
      )}
      aria-hidden="true"
    >
      {on && <Check size={12} strokeWidth={3} />}
    </span>
  )
}

const choiceCard = (on: boolean, disabled = false) =>
  clsx(
    'w-full rounded-xl border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
    on
      ? 'border-brand-600 bg-brand-50/70 ring-1 ring-brand-600 dark:border-brand-400 dark:bg-brand-500/10 dark:ring-brand-400'
      : disabled
        ? 'cursor-not-allowed border-slate-200 opacity-60 dark:border-white/10'
        : 'border-slate-200 bg-white hover:border-brand-300 hover:shadow-soft dark:border-white/10 dark:bg-transparent dark:hover:border-brand-400/50',
  )

function Packages({ plan, display }: { plan: Plan; display: Display }) {
  const choosePackage = usePlanAction('choosePackage')
  const readOnly = usePlanReadOnly()
  if (!plan.packages.length) return null
  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle
        icon={<PackageIcon size={18} />}
        title="Packages"
        subtitle="Switching changes travel, hotels and food level only — your day-by-day plan stays the same."
      />
      <div className="grid gap-3 md:grid-cols-3">
        {plan.packages.map((pkg) => {
          const on = pkg.name === plan.recommended_package
          return (
            <button key={pkg.name} onClick={() => !on && choosePackage(pkg.name)} aria-pressed={on} className={clsx(choiceCard(on), 'flex flex-col p-4')}>
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{pkg.label}</span>
                {on ? <Badge tone="brand"><Check size={12} /> Selected</Badge> : <Delta amount={pkg.total - plan.estimated_cost} display={display} />}
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{formatMoney(pkg.total, display)}</div>
              <div className="mb-3 mt-1">
                <Badge tone={pkg.fits_budget ? 'green' : 'red'}>{pkg.fits_budget ? 'Within budget' : 'Over budget'}</Badge>
              </div>
              <ul className="w-full flex-1 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                {pkg.transport && <li className="flex gap-2"><ModeIcon kind={pkg.transport.kind} /> {pkg.transport.label}</li>}
                {pkg.hotels.map((hotel) => (
                  <li key={hotel.option_id} className="flex gap-2">
                    <BedDouble size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <span>
                      {hotel.name}
                      <span className="text-slate-400"> · {formatMoney(hotel.price_per_night, display)}/night</span>
                    </span>
                  </li>
                ))}
              </ul>
              <span
                className={clsx(
                  'mt-3 inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold',
                  on ? 'bg-brand-700 text-white dark:bg-brand-500' : 'border border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-200',
                )}
              >
                {on ? (readOnly ? 'Chosen package' : 'Your package') : readOnly ? pkg.label : `Choose ${pkg.label}`}
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function ModeIcon({ kind, className = 'mt-0.5 shrink-0 text-slate-400', size = 15 }: { kind: string; className?: string; size?: number }) {
  if (kind === 'flight') return <Plane size={size} className={className} />
  if (kind === 'train') return <TrainFront size={size} className={className} />
  if (kind === 'bus') return <Bus size={size} className={className} />
  return <Car size={size} className={className} />
}

function GettingThere({ plan, display }: { plan: Plan; display: Display }) {
  const chooseTransport = usePlanAction('chooseTransport')
  const choice = plan.transport_choice
  const flights = plan.selected_flights
  const ground = plan.ground_options
  const hasFlights = flights.length > 0
  const hasGround = ground.length > 0
  const [view, setView] = useState<'flight' | 'ground' | null>(null)
  if (!choice && !hasGround && !hasFlights) return null
  const travelers = pricingOf(plan).travelers
  const current = choice?.round_trip_total ?? 0
  const shown = view ?? (choice?.kind === 'flight' || !hasGround ? 'flight' : 'ground')
  const outboundId = choice?.kind === 'flight' ? plan.recommended_outbound_id : null
  const returnId = choice?.kind === 'flight' ? plan.recommended_return_id : null

  const pickFlight = (outbound: string | null, ret: string | null) => {
    const out = outbound ?? plan.recommended_outbound_id ?? flights.find((f) => f.price != null)?.option_id
    if (!out) return
    chooseTransport({ kind: 'flight', outbound: out, ret: ret ?? plan.recommended_return_id ?? plan.return_flights[0]?.option_id ?? null })
  }

  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle
        icon={<Luggage size={18} />}
        title="Getting there & back"
        subtitle={
          choice
            ? `Selected: ${choice.label} — ${formatMoney(choice.round_trip_total, display)} for ${travelers > 1 ? `all ${travelers}` : 'you'}, both ways${choice.price_is_estimate ? ' (estimate)' : ''}`
            : 'Choose how you travel'
        }
        action={
          hasFlights && hasGround ? (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm font-semibold dark:border-white/10 dark:bg-white/5" role="tablist">
              {(
                [
                  ['flight', 'Flights', <Plane key="p" size={14} />],
                  ['ground', 'Train, bus & cab', <TrainFront key="t" size={14} />],
                ] as const
              ).map(([id, label, icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={shown === id}
                  onClick={() => setView(id)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition',
                    shown === id ? 'bg-white text-brand-800 shadow-sm dark:bg-ink-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white',
                  )}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {shown === 'ground' && hasGround && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            By road or rail{plan.road_km ? ` · ${Math.round(plan.road_km)} km by road` : ''} · tap an option to use it
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ground.map((option) => (
              <GroundCard
                key={option.option_id}
                option={option}
                on={choice?.option_id === option.option_id}
                total={2 * groundOneWay(option, travelers)}
                current={current}
                display={display}
                onPick={() => chooseTransport({ kind: 'ground', id: option.option_id })}
              />
            ))}
          </div>
        </div>
      )}

      {shown === 'flight' && hasFlights && (
        <div className="grid gap-4 md:grid-cols-2">
          <FlightList
            title="Outbound flights"
            flights={flights}
            chosen={outboundId}
            display={display}
            costOf={(f) => (f.price == null ? null : flightFare(f, plan.return_flights.find((r) => r.option_id === (returnId ?? plan.recommended_return_id)) ?? null) * travelers)}
            current={current}
            onPick={(f) => pickFlight(f.option_id, returnId)}
          />
          <FlightList
            title="Return flights"
            flights={plan.return_flights}
            chosen={returnId}
            display={display}
            costOf={(f) => {
              const out = flights.find((o) => o.option_id === (outboundId ?? plan.recommended_outbound_id)) ?? flights[0]
              return out?.price == null ? null : flightFare(out, f) * travelers
            }}
            current={current}
            onPick={(f) => pickFlight(outboundId, f.option_id)}
          />
        </div>
      )}
      {shown === 'flight' && !hasFlights && <p className="text-sm text-slate-500">No flights were found for this route.</p>}
    </Card>
  )
}

function GroundCard({ option, on, total, current, display, onPick }: { option: GroundOption; on: boolean; total: number; current: number; display: Display; onPick: () => void }) {
  return (
    <button onClick={onPick} aria-pressed={on} className={clsx(choiceCard(on), 'flex items-center gap-3 p-3')}>
      <Radio on={on} />
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300">
        <ModeIcon kind={option.kind} className="" size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">{option.label}</span>
        <span className="flex items-center gap-1 text-xs text-slate-500">
          {duration(option.duration_minutes)}
          {option.overnight && (
            <>
              {' · '}
              <Moon size={11} /> overnight
            </>
          )}
          {' · '}
          {formatMoney(option.price_pp, display, true)} pp one way
        </span>
      </span>
      <span className="text-right">
        <span className="block text-sm font-bold tabular-nums text-slate-900 dark:text-white">{formatMoney(total, display, true)}</span>
        {on ? <span className="text-[11px] font-medium text-brand-700 dark:text-brand-300">selected</span> : <Delta amount={total - current} display={display} />}
      </span>
    </button>
  )
}

function FlightList({
  title,
  flights,
  chosen,
  display,
  costOf,
  current,
  onPick,
}: {
  title: string
  flights: Flight[]
  chosen: string | null
  display: Display
  costOf: (flight: Flight) => number | null
  current: number
  onPick: (flight: Flight) => void
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="space-y-2">
        {flights.slice(0, 6).map((flight) => {
          const on = flight.option_id === chosen
          const cost = costOf(flight)
          const disabled = cost == null
          return (
            <button key={flight.option_id} disabled={disabled} onClick={() => !on && onPick(flight)} aria-pressed={on} className={clsx(choiceCard(on, disabled), 'p-3 text-sm')}>
              <div className="flex items-center gap-3">
                <Radio on={on} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-slate-900 dark:text-white">{flight.airline || 'Flight'}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {flight.price_included ? (
                        <span className="text-xs font-normal text-slate-500">in round-trip fare</span>
                      ) : flight.price != null ? (
                        `${formatMoney(flight.price, display, flight.price_is_estimate)}${flight.price_scope?.startsWith('round') ? ' rt' : ''} pp`
                      ) : (
                        'fare n/a'
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-slate-600 dark:text-slate-300">
                    <span className="font-medium tabular-nums">{clockFromIso(flight.departure_time)}</span>
                    <span className="text-xs text-slate-400">{flight.origin}</span>
                    <span className="text-slate-400">→</span>
                    <span className="font-medium tabular-nums">{clockFromIso(flight.arrival_time)}</span>
                    <span className="text-xs text-slate-400">{flight.destination}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {duration(flight.duration_minutes)} · {flight.stops ? `${flight.stops} stop${flight.stops > 1 ? 's' : ''}${flight.via ? ` via ${flight.via}` : ''}` : 'non-stop'}
                      {flight.flight_number ? ` · ${flight.flight_number}` : ''}
                    </span>
                    {!on && cost != null && <Delta amount={cost - current} display={display} />}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
        {flights.length === 0 && <div className="text-sm text-slate-500">None found.</div>}
      </div>
    </div>
  )
}

function Hotels({ plan, display }: { plan: Plan; display: Display }) {
  const chooseHotel = usePlanAction('chooseHotel')
  if (!plan.selected_hotels.length) return null
  const pricing = pricingOf(plan)
  const chosen = new Set(plan.recommended_hotel_ids)
  const reference = plan.packages.find((p) => p.name === plan.recommended_package) ?? plan.packages[0]
  const cities = [...new Set(plan.selected_hotels.map((h) => h.city ?? ''))]
  const nightsFor = (city: string) => reference?.hotels.find((h) => (h.city ?? '') === city)?.nights ?? pricing.nights ?? 1

  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle
        icon={<BedDouble size={18} />}
        title="Hotels"
        subtitle={`Tap a hotel to stay there — costs and the itinerary update instantly. Prices are per room per night; ${pricing.rooms} room${pricing.rooms > 1 ? 's' : ''}.`}
      />
      <div className="space-y-5">
        {cities.map((city) => {
          const hotels = plan.selected_hotels.filter((h) => (h.city ?? '') === city)
          const nights = nightsFor(city)
          const currentHotel = hotels.find((h) => chosen.has(h.option_id))
          const currentCost = (currentHotel?.price_per_night ?? 0) * nights * pricing.rooms
          // A fixed order (cheapest first): choosing a hotel highlights it in place instead of moving it.
          const sorted = [...hotels].sort((a, b) => (a.price_per_night ?? Infinity) - (b.price_per_night ?? Infinity))
          return (
            <div key={city}>
              {cities.length > 1 && (
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <MapPin size={13} /> {city || 'Stay'} · {nights} night{nights > 1 ? 's' : ''}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sorted.map((hotel) => (
                  <HotelCard
                    key={hotel.option_id}
                    hotel={hotel}
                    on={chosen.has(hotel.option_id)}
                    stayCost={(hotel.price_per_night ?? 0) * nights * pricing.rooms}
                    currentCost={currentCost}
                    nights={nights}
                    display={display}
                    onPick={() => chooseHotel(city, hotel.option_id)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function HotelCard({ hotel, on, stayCost, currentCost, nights, display, onPick }: { hotel: Hotel; on: boolean; stayCost: number; currentCost: number; nights: number; display: Display; onPick: () => void }) {
  const priced = hotel.price_per_night != null
  return (
    <div className={clsx(choiceCard(on, !priced), 'flex flex-col')}>
      <button disabled={!priced} onClick={() => !on && onPick()} aria-pressed={on} className="flex flex-1 flex-col p-3 text-left focus:outline-none">
        <div className="flex w-full items-start gap-2.5">
          <Radio on={on} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">{hotel.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              {hotel.stars ? <span className="text-amber-500">{'★'.repeat(Math.round(hotel.stars))}</span> : hotel.tier && <span className="capitalize">{hotel.tier}</span>}
              {hotel.rating != null && (
                <span className="inline-flex items-center gap-0.5">
                  <Star size={11} className="fill-amber-400 text-amber-400" /> {hotel.rating}
                  {hotel.reviews ? ` (${hotel.reviews.toLocaleString()})` : ''}
                </span>
              )}
              {hotel.distance_to_center_km != null && (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin size={11} /> {hotel.distance_to_center_km < 1 ? `${Math.round(hotel.distance_to_center_km * 1000)} m` : `${hotel.distance_to_center_km.toFixed(1)} km`} from centre
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex w-full items-end justify-between gap-2 pl-[30px]">
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {priced ? formatMoney(hotel.price_per_night, display, hotel.data_source !== 'live') : 'rate n/a'}
              <span className="text-xs font-normal text-slate-500"> / night</span>
            </div>
            {priced && <div className="text-[11px] text-slate-500">{formatMoney(stayCost, display)} for {nights} night{nights > 1 ? 's' : ''}</div>}
          </div>
          {on ? <Badge tone="brand"><Check size={12} /> Selected</Badge> : priced && <Delta amount={stayCost - currentCost} display={display} />}
        </div>
        {hotel.amenities && hotel.amenities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 pl-[30px]">
            {hotel.amenities.slice(0, 3).map((a) => <Badge key={a}>{a}</Badge>)}
          </div>
        )}
      </button>
      {hotel.link && (
        <div className="border-t border-slate-100 px-3 py-2 pl-[42px] dark:border-white/5">
          <ExternalLink href={hotel.link} className="text-xs">Hotel website</ExternalLink>
        </div>
      )}
    </div>
  )
}

function Weather({ plan }: { plan: Plan }) {
  const weather = plan.weather_information
  return (
    <Card className="p-4 sm:p-5">
      <SectionTitle icon={<CloudSun size={18} />} title="Weather & packing" subtitle={weather.summary ?? undefined} />
      {weather.dates_assumed && <p className="mb-2 text-xs text-amber-600">No travel dates were given, so the next few days are shown as a guide.</p>}
      <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {weather.days.map((day) => (
          <div key={`${day.day}-${day.date}`} className="min-w-[110px] rounded-lg border border-slate-100 bg-slate-50 p-3 text-center dark:border-white/5 dark:bg-white/5">
            <div className="text-xs font-semibold text-slate-500">Day {day.day}</div>
            <div className="text-xs text-slate-400">{prettyDate(day.date)}</div>
            <div className="my-1 text-2xl">{weatherEmoji(day.condition)}</div>
            <div className="text-sm font-semibold">{Math.round(day.temp_max_c ?? 0)}° <span className="font-normal text-slate-400">{Math.round(day.temp_min_c ?? 0)}°</span></div>
            <div className="text-xs capitalize text-slate-500">{day.condition}</div>
            <div className="text-xs text-brand-600 dark:text-brand-300">💧 {day.precipitation_probability ?? 0}%</div>
            {day.source === 'seasonal_historical' && <div className="mt-1 text-[10px] text-slate-400">typical</div>}
          </div>
        ))}
        {weather.days.length === 0 && <div className="text-sm text-slate-500">Weather is not available.</div>}
      </div>
      {plan.packing_tips.length > 0 && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {plan.packing_tips.map((tip) => (
            <li key={tip} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Check size={15} className="mt-0.5 shrink-0 text-emerald-500" /> {tip}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

