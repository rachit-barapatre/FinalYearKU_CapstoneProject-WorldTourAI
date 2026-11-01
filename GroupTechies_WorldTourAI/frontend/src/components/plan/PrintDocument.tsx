// The printable travel document ("Download PDF"): an A4 e-ticket style itinerary with photos.
// It is rendered next to #root only while printing; the browser's print dialog saves it as a PDF.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { placeImage, wikiImage } from '../../lib/images'
import { fillMoney, formatMoney, hhmm, prettyDate, type Display } from '../../lib/money'
import { pricingOf } from '../../lib/selection'
import type { Activity, ItineraryDay, Plan } from '../../lib/types'
import { weatherEmoji } from '../../lib/weather'

const SIGHT_SKIP = new Set(['travel', 'transfer', 'meal', 'stay', 'free'])

function tripId(plan: Plan): string {
  const text = `${plan.origin}|${plan.destination}|${plan.dates.start_date}|${plan.duration.days}|${plan.travelers}`
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `WT-${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7)}`
}

function addDays(iso: string | null, days: number): string | null {
  if (!iso) return null
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function sightsOf(day: ItineraryDay): Activity[] {
  return day.activities.filter((a) => !SIGHT_SKIP.has(a.category) && !a.name.startsWith('Dinner at'))
}

const SITE = 'https://worldtour-xi.vercel.app'

/** "irctc.co.in" from a booking URL, for link labels. */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function waitForImages(root: HTMLElement, limitMs: number): Promise<void> {
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete)
  const loads = pending.map((img) => new Promise<void>((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => resolve(), { once: true })
  }))
  return Promise.race([Promise.all(loads).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, limitMs))])
}

export function PrintDocument({ plan, display, onDone }: { plan: Plan; display: Display; onDone: () => void }) {
  const [images, setImages] = useState<Record<string, string | null> | null>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const id = useMemo(() => tripId(plan), [plan])
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])

  // 1. Find photos: the destination, and up to three sights per day.
  useEffect(() => {
    let live = true
    const sights = plan.daily_itinerary.flatMap((day) => sightsOf(day).slice(0, 3).map((sight) => ({ id: sight.activity_id, name: sight.name, city: day.city })))
    void Promise.all([
      wikiImage([plan.cities[0], plan.destination], 1280).catch(() => null),
      ...sights.map((sight) => placeImage(sight.name, sight.city ?? plan.destination, 500).catch(() => null)),
    ]).then(([cover, ...found]) => {
      if (!live) return
      // The same photo twice (e.g. a sight whose article is the city itself) is shown once.
      const seen = new Set([cover])
      const result: Record<string, string | null> = { cover }
      sights.forEach((sight, index) => {
        const url = found[index]
        result[sight.id] = url && !seen.has(url) ? url : null
        seen.add(url)
      })
      setImages(result)
    })
    return () => {
      live = false
    }
  }, [plan])

  // 2. Once the photos have loaded, open the print dialog (Save as PDF), then clean up.
  useEffect(() => {
    if (!images || !root) return
    let finished = false
    const title = document.title
    const finish = () => {
      if (finished) return
      finished = true
      document.body.classList.remove('printing')
      document.title = title
      done.current()
    }
    document.body.classList.add('printing')
    window.addEventListener('afterprint', finish, { once: true })
    void waitForImages(root, 6000).then(() => {
      document.title = `WorldTour-${(plan.destination || 'trip').replace(/[^\w-]+/g, '-')}-itinerary-${id}`
      window.print()
      // Some browsers never fire afterprint; print() returns once the dialog closes.
      setTimeout(finish, 500)
    })
    return () => {
      window.removeEventListener('afterprint', finish)
      document.body.classList.remove('printing')
      document.title = title
    }
  }, [images, root, plan.destination, id])

  const pricing = pricingOf(plan)
  const pkg = plan.packages.find((p) => p.name === plan.recommended_package)
  const reference = pkg ?? plan.packages[0]
  const days = plan.daily_itinerary
  const first = days[0]
  const last = days[days.length - 1]
  const outbound = first?.activities.find((a) => a.activity_id === 'flight:outbound' || a.activity_id === 'ground:outbound')
  const inbound = last?.activities.find((a) => a.activity_id === 'flight:return' || a.activity_id === 'ground:return')
  const choice = plan.transport_choice
  const flightOut = plan.selected_flights.find((f) => f.option_id === plan.recommended_outbound_id)
  const flightBack = plan.return_flights.find((f) => f.option_id === plan.recommended_return_id)
  const hotels = Object.values(
    Object.fromEntries(plan.selected_hotels.filter((h) => plan.recommended_hotel_ids.includes(h.option_id)).map((h) => [h.city ?? '', h])),
  )
  const weather = new Map(plan.weather_information.days.map((w) => [w.day, w]))
  const over = plan.remaining_budget != null && plan.remaining_budget < 0
  const bookingFor = (name: string) => plan.links.hotels?.find((h) => h.name === name)?.url ?? null
  const placeLink = (dayNumber: number, name: string) =>
    plan.links.places?.find((place) => place.day === dayNumber && name.replace(/^Dinner at /, '') === place.name)?.url ?? null
  let checkinOffset = 0

  const journey = [
    outbound && {
      leg: 'Onward',
      mode: choice?.kind === 'flight' ? `${flightOut?.airline ?? 'Flight'} ${flightOut?.flight_number ?? ''}`.trim() : choice?.label ?? outbound.name,
      from: flightOut?.origin ?? plan.origin ?? '—',
      to: flightOut?.destination ?? first?.city ?? plan.destination ?? '—',
      date: plan.dates.start_date,
      departs: outbound.start_minute === 0 && outbound.detail.includes('Overnight') ? 'Previous night' : hhmm(outbound.start_minute),
      arrives: hhmm(outbound.end_minute),
    },
    inbound && {
      leg: 'Return',
      mode: choice?.kind === 'flight' ? `${flightBack?.airline ?? 'Flight'} ${flightBack?.flight_number ?? ''}`.trim() : choice?.label ?? inbound.name,
      from: flightBack?.origin ?? last?.city ?? plan.destination ?? '—',
      to: flightBack?.destination ?? plan.origin ?? '—',
      date: plan.dates.end_date,
      departs: hhmm(inbound.start_minute),
      arrives: inbound.detail.includes('next day') ? `${hhmm(inbound.end_minute)} (+1)` : hhmm(inbound.end_minute),
    },
  ].filter(Boolean) as { leg: string; mode: string; from: string; to: string; date: string | null; departs: string; arrives: string }[]

  const doc = (
    <div className="print-doc" ref={setRoot}>
      <style>{CSS}</style>
      <div className="pd">
        <header className="pd-head">
          <div className="pd-brand">
            <img className="pd-logo" src="/logo-globe.svg" alt="" />
            <div>
              <div className="pd-name">WorldTour</div>
              <div className="pd-sub">Trip Itinerary · Electronic Travel Plan</div>
            </div>
          </div>
          <div className="pd-ref">
            <div><span>Trip ID</span><b>{id}</b></div>
            <div><span>Generated</span><b>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b></div>
          </div>
        </header>

        <table className="pd-page">
          <thead><tr><td><div className="pd-space" /></td></tr></thead>
          <tfoot>
            <tr>
              <td>
                <div className="pd-page-foot">
                  <span><a href={SITE}>WorldTour · worldtour-xi.vercel.app</a></span>
                  <span>Trip ID {id} · {plan.origin || '—'} → {plan.destination || '—'}</span>
                </div>
              </td>
            </tr>
          </tfoot>
          <tbody><tr><td className="pd-body">

        <section className="pd-cover">
          {images?.cover && <img src={images.cover} alt="" />}
          <div className="pd-cover-text">
            <div className="pd-route">{plan.origin || '—'} &nbsp;→&nbsp; {plan.destination || '—'}</div>
            <div className="pd-title">{plan.trip_summary}</div>
            <div className="pd-dates">
              {plan.dates.start_date ? `${prettyDate(plan.dates.start_date, true)} – ${prettyDate(plan.dates.end_date, true)}` : 'Flexible dates'}
            </div>
          </div>
        </section>

        <h2 className="pd-h">Trip summary</h2>
        <table className="pd-grid">
          <tbody>
            <tr>
              <Cell label="From" value={plan.origin || '—'} />
              <Cell label="To" value={plan.cities.length > 1 ? plan.cities.join(', ') : plan.destination || '—'} />
              <Cell label="Duration" value={`${plan.duration.days ?? days.length} days / ${plan.duration.nights ?? pricing.nights ?? '—'} nights`} />
              <Cell label="Travellers" value={`${pricing.travelers} adult${pricing.travelers > 1 ? 's' : ''}`} />
            </tr>
            <tr>
              <Cell label="Rooms" value={String(pricing.rooms)} />
              <Cell label="Package" value={pkg ? pkg.label : 'Custom'} />
              <Cell label="Pace" value={plan.pace || 'balanced'} cap />
              <Cell label="Interests" value={plan.preferences.join(', ') || '—'} cap />
            </tr>
          </tbody>
        </table>

        {journey.length > 0 && (
          <>
            <h2 className="pd-h">Journey details</h2>
            <table className="pd-table">
              <thead>
                <tr><th>Journey</th><th>Mode / carrier</th><th>From</th><th>Date</th><th>Departs</th><th>To</th><th>Arrives</th></tr>
              </thead>
              <tbody>
                {journey.map((row) => (
                  <tr key={row.leg}>
                    <td><b>{row.leg}</b></td>
                    <td>{row.mode}</td>
                    <td>{row.from}</td>
                    <td>{row.date ? prettyDate(row.date) : '—'}</td>
                    <td className="pd-num">{row.departs}</td>
                    <td>{row.to}</td>
                    <td className="pd-num">{row.arrives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="pd-note">
              {choice ? `${choice.label} · ${formatMoney(choice.round_trip_total, display)} for ${pricing.travelers} traveller(s), both ways${choice.price_is_estimate ? ' (estimated fare)' : ''}.` : ''} Report at the airport 2–3 hours, or the station 30 minutes, before departure.
            </p>
          </>
        )}

        {hotels.length > 0 && (
          <>
            <h2 className="pd-h">Accommodation</h2>
            <table className="pd-table">
              <thead>
                <tr><th>Hotel</th><th>City</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Rooms</th><th className="pd-num">Rate / night</th><th className="pd-num">Amount</th></tr>
              </thead>
              <tbody>
                {hotels.map((hotel) => {
                  const nights = reference?.hotels.find((h) => (h.city ?? '') === (hotel.city ?? ''))?.nights ?? pricing.nights ?? 1
                  const checkin = addDays(plan.dates.start_date, checkinOffset)
                  checkinOffset += nights
                  return (
                    <tr key={hotel.option_id}>
                      <td>
                        {bookingFor(hotel.name) ? <a href={bookingFor(hotel.name)!}><b>{hotel.name}</b></a> : <b>{hotel.name}</b>}
                        {hotel.rating != null && <div className="pd-muted">★ {hotel.rating}{hotel.stars ? ` · ${hotel.stars}-star` : hotel.tier ? ` · ${hotel.tier}` : ''}</div>}
                      </td>
                      <td>{hotel.city || '—'}</td>
                      <td>{checkin ? prettyDate(checkin) : '—'}</td>
                      <td>{checkin ? prettyDate(addDays(checkin, nights)) : '—'}</td>
                      <td className="pd-num">{nights}</td>
                      <td className="pd-num">{pricing.rooms}</td>
                      <td className="pd-num">{formatMoney(hotel.price_per_night, display, hotel.data_source !== 'live')}</td>
                      <td className="pd-num"><b>{formatMoney((hotel.price_per_night ?? 0) * nights * pricing.rooms, display)}</b></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}

        <h2 className="pd-h">Cost summary</h2>
        <table className="pd-table pd-fare">
          <tbody>
            {plan.budget_breakdown.map((row) => (
              <tr key={row.category}>
                <td><b>{row.category}</b>{row.detail && <div className="pd-muted">{fillMoney(row.detail, display)}</div>}</td>
                <td className="pd-num">{formatMoney(row.cost, display)}</td>
              </tr>
            ))}
            <tr className="pd-total">
              <td>Estimated total</td>
              <td className="pd-num">{formatMoney(plan.estimated_cost, display)}</td>
            </tr>
            {plan.budget.planning_budget != null && (
              <tr>
                <td>{over ? 'Over your budget by' : 'Left from your budget'}</td>
                <td className={`pd-num ${over ? 'pd-bad' : 'pd-good'}`}>{formatMoney(Math.abs(plan.remaining_budget ?? 0), display)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <h2 className="pd-h">Day-wise itinerary</h2>
        {days.map((day) => {
          const w = weather.get(day.day)
          const photos = sightsOf(day).slice(0, 3).filter((s) => images?.[s.activity_id])
          return (
            <section key={day.day} className="pd-day">
              <div className="pd-day-head">
                <div>
                  <span className="pd-day-no">DAY {day.day}</span>
                  <span className="pd-day-title">{day.title.replace(/^Day \d+\s*[–-]\s*/, '')}</span>
                </div>
                <div className="pd-day-meta">
                  {day.date ? prettyDate(day.date, true) : ''}{day.city ? ` · ${day.city}` : ''}
                  {w ? ` · ${weatherEmoji(w.condition)} ${Math.round(w.temp_max_c ?? 0)}°/${Math.round(w.temp_min_c ?? 0)}° · rain ${w.precipitation_probability ?? 0}%` : ''}
                </div>
              </div>
              {photos.length > 0 && (
                <div className={`pd-photos pd-photos-${photos.length}`}>
                  {photos.map((sight) => (
                    <figure key={sight.activity_id}>
                      <img src={images![sight.activity_id]!} alt="" />
                      <figcaption>{sight.name}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <table className="pd-table pd-time">
                <thead>
                  <tr><th style={{ width: '17%' }}>Time</th><th>Activity</th><th style={{ width: '13%' }} className="pd-num">Est. cost</th></tr>
                </thead>
                <tbody>
                  {day.activities.map((a) => (
                    <tr key={a.activity_id} className={a.category === 'transfer' ? 'pd-transfer' : undefined}>
                      <td className="pd-num">{hhmm(a.start_minute)} – {hhmm(a.end_minute)}</td>
                      <td>
                        {placeLink(day.day, a.name) ? <a href={placeLink(day.day, a.name)!}><b>{a.name}</b></a> : <b>{a.name}</b>}
                        {a.detail && <div className="pd-muted">{fillMoney(a.detail, display)}</div>}
                      </td>
                      <td className="pd-num">{a.cost_usd ? formatMoney(a.cost_usd, display, true) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pd-day-foot">
                {day.stay_name && day.stay_name !== '—' ? <span>Night stay: <b>{day.stay_name}</b></span> : <span>Journey home</span>}
                {!!day.local_transport_usd && <span>Local transport today: <b>{formatMoney(day.local_transport_usd, display, true)}</b></span>}
              </div>
              {day.notes?.map((note) => <p key={note} className="pd-note">{note}</p>)}
            </section>
          )
        })}

        <div className="pd-two">
          {plan.packing_tips.length > 0 && (
            <section>
              <h2 className="pd-h">Packing checklist</h2>
              <ul className="pd-check">
                {plan.packing_tips.map((tip) => <li key={tip}>{tip}</li>)}
              </ul>
            </section>
          )}
          <section>
            <h2 className="pd-h">Bookings</h2>
            <ul className="pd-links">
              {plan.links.ground && (
                <li><b>{plan.links.ground.label}</b><br /><a href={plan.links.ground.url}>Book on {host(plan.links.ground.url)} ↗</a></li>
              )}
              {choice?.kind === 'flight' && plan.links.flights && (
                <li><b>Flights {flightOut?.origin} → {flightOut?.destination}</b><br /><a href={plan.links.flights}>Compare and book on Google Flights ↗</a></li>
              )}
              {plan.links.hotels?.map((h) => {
                const site = plan.selected_hotels.find((hotel) => hotel.name === h.name)?.link
                return (
                  <li key={h.url}>
                    <b>{h.name}</b><br />
                    <a href={h.url}>Book on Booking.com ↗</a>
                    {site && <> · <a href={site}>Hotel website ↗</a></>}
                  </li>
                )
              })}
              <li><b>Plan another trip</b><br /><a href={SITE}>Open WorldTour ↗</a></li>
            </ul>
          </section>
        </div>

        <h2 className="pd-h">Important information</h2>
        <ol className="pd-info">
          <li>This is a travel plan, not a ticket or booking confirmation. Book each item on the provider's website before you travel.</li>
          <li>Prices are planning estimates converted at today's exchange rate; fares and room rates change quickly.</li>
          <li>Carry a government photo ID for every traveller (passport for international trips) and keep copies of your bookings.</li>
          {[...plan.data_notes, ...plan.warnings].slice(0, 5).map((note) => <li key={note}>{note}</li>)}
        </ol>

          </td></tr></tbody>
        </table>
      </div>
    </div>
  )
  return createPortal(doc, document.body)
}

function Cell({ label, value, cap = false }: { label: string; value: string; cap?: boolean }) {
  return (
    <td>
      <div className="pd-label">{label}</div>
      <div className={cap ? 'pd-value pd-cap' : 'pd-value'}>{value}</div>
    </td>
  )
}

const CSS = `
.print-doc { font-family: Inter, 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; background: #fff; }
.pd { width: 100%; font-size: 10.5pt; line-height: 1.45; }
.pd b { font-weight: 600; }
.pd a { color: #1f4a8c; text-decoration: underline; text-underline-offset: 1.5pt; }
.pd a b { color: #1f4a8c; }
.pd-head { display: flex; justify-content: space-between; align-items: center; background: #10284d; color: #fff; padding: 9mm 10mm 7mm; border-bottom: 4pt solid #ee8a1f; }
.pd-brand { display: flex; align-items: center; gap: 10pt; }
.pd-logo { width: 40pt; height: 40pt; }
.pd-name { font-size: 19pt; font-weight: 800; letter-spacing: -0.01em; }
.pd-sub { font-size: 10pt; opacity: 0.85; }
.pd-ref { text-align: right; font-size: 10pt; line-height: 1.6; }
.pd-ref span { opacity: 0.75; margin-right: 6pt; }
.pd-ref b { font-size: 11.5pt; letter-spacing: 0.04em; }
.pd-page { width: 100%; border-collapse: collapse; }
.pd-page > thead > tr > td, .pd-page > tfoot > tr > td { padding: 0; }
.pd-space { height: 6mm; }
.pd-body { padding: 0 10mm; vertical-align: top; }
.pd-page-foot { display: flex; justify-content: space-between; gap: 10pt; margin: 4mm 10mm 0; padding: 2.5mm 0 5mm; border-top: 1pt solid #cbd5e1; font-size: 8.5pt; color: #64748b; }
.pd-page-foot a { color: #64748b; text-decoration: none; }
.pd-cover { position: relative; height: 72mm; border-radius: 6pt; overflow: hidden; background: #13305e; }
.pd-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pd-cover::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,26,51,0.9) 0%, rgba(10,26,51,0.55) 55%, rgba(10,26,51,0.15) 100%); }
.pd-cover-text { position: absolute; left: 16pt; bottom: 14pt; right: 16pt; z-index: 1; color: #fff; }
.pd-route { font-size: 10pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.9; }
.pd-title { font-size: 25pt; font-weight: 800; margin-top: 2pt; line-height: 1.15; }
.pd-dates { margin-top: 6pt; display: inline-block; background: #ee8a1f; color: #fff; font-weight: 700; font-size: 10.5pt; padding: 3pt 10pt; border-radius: 12pt; }
.pd-h { font-size: 12.5pt; font-weight: 800; color: #10284d; text-transform: uppercase; letter-spacing: 0.07em; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #10284d; break-after: avoid; }
.pd-grid { width: 100%; border-collapse: collapse; }
.pd-grid td { border: 0.75pt solid #cbd5e1; padding: 6pt 8pt; vertical-align: top; width: 25%; }
.pd-label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; font-weight: 600; }
.pd-value { font-size: 11.5pt; font-weight: 700; color: #0f172a; margin-top: 1pt; }
.pd-cap { text-transform: capitalize; }
.pd-table { width: 100%; border-collapse: collapse; }
.pd-table th { background: #e8eef7; color: #10284d; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; padding: 6pt 7pt; border: 0.75pt solid #cbd5e1; }
.pd-table td { padding: 6pt 7pt; border: 0.75pt solid #cbd5e1; vertical-align: top; }
.pd-table tr { break-inside: avoid; }
.pd-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pd-table td.pd-num:first-child, .pd-time td:first-child { text-align: left; }
.pd-muted { color: #475569; font-size: 9.5pt; margin-top: 1.5pt; }
.pd-note { color: #334155; font-size: 9.5pt; margin: 5pt 0 0; }
.pd-fare td:first-child { width: 76%; }
.pd-total td { background: #10284d; color: #fff; font-weight: 800; font-size: 12.5pt; }
.pd-good { color: #047857; font-weight: 700; }
.pd-bad { color: #be123c; font-weight: 700; }
.pd-day { margin-bottom: 14pt; }
.pd-day-head { display: flex; justify-content: space-between; align-items: center; gap: 8pt; background: #10284d; color: #fff; padding: 7pt 10pt; border-radius: 4pt 4pt 0 0; break-after: avoid; }
.pd-day-no { background: #ee8a1f; color: #fff; font-weight: 800; font-size: 9.5pt; padding: 2pt 7pt; border-radius: 3pt; margin-right: 8pt; letter-spacing: 0.06em; }
.pd-day-title { font-weight: 700; font-size: 12pt; }
.pd-day-meta { font-size: 9.5pt; opacity: 0.92; text-align: right; }
.pd-photos { display: grid; gap: 5pt; margin: 5pt 0; break-inside: avoid; break-after: avoid; }
.pd-photos-1 { grid-template-columns: 1fr; }
.pd-photos-2 { grid-template-columns: 1fr 1fr; }
.pd-photos-3 { grid-template-columns: 1fr 1fr 1fr; }
.pd-photos figure { margin: 0; position: relative; height: 40mm; border-radius: 4pt; overflow: hidden; background: #e2e8f0; }
.pd-photos-1 figure { height: 52mm; }
.pd-photos img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pd-photos figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 12pt 7pt 4pt; font-size: 9pt; font-weight: 600; color: #fff; background: linear-gradient(transparent, rgba(0,0,0,0.72)); }
.pd-time td { font-size: 10pt; }
.pd-transfer td { color: #475569; background: #f8fafc; }
.pd-transfer b { font-weight: 500; }
.pd-day-foot { display: flex; justify-content: space-between; gap: 8pt; font-size: 9.5pt; color: #334155; border: 0.75pt solid #cbd5e1; border-top: 0; padding: 5pt 7pt; background: #f8fafc; }
.pd-two { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16pt; break-inside: avoid; }
.pd-check { list-style: none; padding: 0; margin: 0; }
.pd-check li { position: relative; padding-left: 17pt; margin-bottom: 5pt; }
.pd-check li::before { content: ''; position: absolute; left: 0; top: 3pt; width: 9pt; height: 9pt; border: 1pt solid #10284d; border-radius: 1.5pt; }
.pd-links { list-style: none; padding: 0; margin: 0; }
.pd-links li { margin-bottom: 6pt; line-height: 1.4; }
.pd-info { padding-left: 16pt; margin: 0; color: #334155; }
.pd-info li { margin-bottom: 4pt; break-inside: avoid; }
`

