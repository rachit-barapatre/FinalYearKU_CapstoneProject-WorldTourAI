import type { Plan } from './types'

/**
 * "Add to calendar", built in the browser so it is instant and works on shared pages too:
 *  - an .ics file with every timetable item (Apple Calendar, Outlook desktop, Google import), and
 *  - Google Calendar / Outlook.com links that open a pre-filled event for the whole trip.
 */

const pad = (n: number) => String(n).padStart(2, '0')

function addDays(iso: string, days: number): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d + days)
}

/** Local "floating" time: 09:30 stays 09:30 wherever the traveler opens the calendar. */
function stamp(date: Date, minute = 0): string {
  const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minute)
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}T${pad(at.getHours())}${pad(at.getMinutes())}00`
}

const dayStamp = (date: Date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`

function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 octets are folded, as the iCalendar standard asks. */
function fold(line: string): string {
  const out: string[] = []
  let rest = line
  while (rest.length > 74) {
    out.push(rest.slice(0, 74))
    rest = ' ' + rest.slice(74)
  }
  out.push(rest)
  return out.join('\r\n')
}

/**
 * The day the trip starts: the traveler's date, else the date the planner assumed for flexible
 * dates (plans saved before planned_start existed fall back to the first forecast day).
 */
export function tripStart(plan: Plan): string | null {
  return plan.dates.start_date || plan.dates.planned_start || plan.daily_itinerary?.find((d) => d.date)?.date || plan.weather_information?.days?.[0]?.date || null
}

export function tripDays(plan: Plan): number {
  return plan.duration.days || plan.daily_itinerary?.length || 1
}

/** A short plain-text outline of the trip (calendar descriptions, "Copy summary"). */
export function planOutline(plan: Plan, { withTimes = true } = {}): string {
  const lines = [plan.trip_summary]
  const where = [plan.origin, plan.destination].filter(Boolean).join(' → ')
  if (where) lines.push(where)
  if (plan.dates.start_date) lines.push(`${plan.dates.start_date}${plan.dates.end_date ? ` to ${plan.dates.end_date}` : ''}`)
  else if (tripStart(plan)) lines.push(`Flexible dates (planned from ${tripStart(plan)})`)
  lines.push(`${plan.travelers || 1} traveler${(plan.travelers || 1) > 1 ? 's' : ''} · ${plan.pace || 'balanced'} pace`)
  for (const day of plan.daily_itinerary ?? []) {
    lines.push('', `Day ${day.day}${day.city ? ` · ${day.city}` : ''}`)
    for (const a of day.activities ?? []) {
      const time = withTimes && Number.isFinite(a.start_minute) ? `${pad(Math.floor(a.start_minute / 60) % 24)}:${pad(a.start_minute % 60)} ` : ''
      lines.push(`• ${time}${a.name}`)
    }
  }
  lines.push('', 'Planned with WorldTour')
  return lines.join('\n')
}

export function icsFile(plan: Plan): string {
  const start = tripStart(plan)
  if (!start) throw new Error('Add travel dates first')
  const now = new Date()
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`
  const slug = (plan.destination || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorldTour//Trip Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escape(plan.trip_summary)}`]
  // One all-day event spanning the trip, so it is visible at a glance in month view.
  lines.push(
    'BEGIN:VEVENT',
    `UID:${start}-trip-${slug}@worldtour`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${dayStamp(addDays(start, 0))}`,
    `DTEND;VALUE=DATE:${dayStamp(addDays(start, tripDays(plan)))}`,
    `SUMMARY:${escape(`✈ ${plan.trip_summary}`)}`,
    `LOCATION:${escape(plan.destination || '')}`,
    `DESCRIPTION:${escape(planOutline(plan))}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  )
  for (const day of plan.daily_itinerary ?? []) {
    const date = day.date ? addDays(day.date, 0) : addDays(start, day.day - 1)
    ;(day.activities ?? []).forEach((a, i) => {
      if (!Number.isFinite(a.start_minute) || !Number.isFinite(a.end_minute)) return
      lines.push(
        'BEGIN:VEVENT',
        `UID:${dayStamp(date)}-${i}-${slug}@worldtour`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${stamp(date, a.start_minute)}`,
        `DTEND:${stamp(date, Math.max(a.end_minute, a.start_minute + 15))}`,
        `SUMMARY:${escape(a.name)}`,
        `LOCATION:${escape(day.city || plan.destination || '')}`,
        `DESCRIPTION:${escape(a.detail || '')}`,
        'END:VEVENT',
      )
    })
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function downloadIcs(plan: Plan) {
  const blob = new Blob([icsFile(plan)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: `${(plan.destination || 'trip').replace(/[^\w-]+/g, '-')}-worldtour.ics` })
  // The link must be in the page for Firefox and Safari, and the URL must outlive the click.
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Google Calendar can't import many events from a link, so it gets one all-day event with the day plan inside. */
export function googleCalendarUrl(plan: Plan): string {
  const start = tripStart(plan)!
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `✈ ${plan.trip_summary}`,
    dates: `${dayStamp(addDays(start, 0))}/${dayStamp(addDays(start, tripDays(plan)))}`,
    details: planOutline(plan).slice(0, 1800),
    location: plan.destination || '',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

export function outlookCalendarUrl(plan: Plan): string {
  const start = tripStart(plan)!
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    allday: 'true',
    subject: `✈ ${plan.trip_summary}`,
    startdt: iso(addDays(start, 0)),
    enddt: iso(addDays(start, tripDays(plan))),
    body: planOutline(plan).slice(0, 1800),
    location: plan.destination || '',
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`
}
