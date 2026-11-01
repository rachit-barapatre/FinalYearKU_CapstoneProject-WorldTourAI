import clsx from 'clsx'
import { CalendarPlus, ChevronDown, Download, ExternalLink as LinkIcon, FileDown, Info, MapPinned, Plane, TrainFront } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl, tripStart } from '../../lib/calendar'
import type { Display } from '../../lib/money'
import { toast } from '../../lib/toast'
import type { Plan } from '../../lib/types'
import { Card, ExternalLink, SectionTitle } from '../ui'

export function BookExport({ plan, onPdf }: { plan: Plan; display: Display; onPdf: () => void }) {
  const links = plan.links || {}

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <SectionTitle icon={<LinkIcon size={18} />} title="Book" subtitle="Prices here are planning estimates — confirm on these sites." />
        <ul className="space-y-2 text-sm">
          {links.ground && (
            <li className="flex items-center gap-2"><TrainFront size={15} className="text-slate-400" /><ExternalLink href={links.ground.url}>{links.ground.label}</ExternalLink></li>
          )}
          {links.flights && (
            <li className="flex items-center gap-2"><Plane size={15} className="text-slate-400" /><ExternalLink href={links.flights}>Flights on Google Flights</ExternalLink></li>
          )}
          {links.hotels?.map((hotel) => (
            <li key={hotel.url} className="flex items-center gap-2"><LinkIcon size={15} className="text-slate-400" /><ExternalLink href={hotel.url}>{hotel.name} on Booking.com</ExternalLink></li>
          ))}
        </ul>
        {!!links.places?.length && (
          <>
            <div className="mb-1.5 mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><MapPinned size={13} /> On the map</div>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {links.places.map((place) => (
                <li key={`${place.day}-${place.name}`}>
                  <span className="text-slate-400">Day {place.day} · </span>
                  <ExternalLink href={place.url}>{place.name}</ExternalLink>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle icon={<Download size={18} />} title="Take it with you" />
        <div className="flex flex-wrap gap-2">
          <button onClick={onPdf} className="btn-shine inline-flex items-center gap-2 rounded-lg bg-coral-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-coral-600">
            <FileDown size={15} /> Download PDF itinerary
          </button>
          <AddToCalendar plan={plan} />
        </div>
        <p className="mt-2 text-xs text-slate-500">The PDF is an e-ticket style travel document with photos, journey and hotel details, costs and every day's timetable. In the print window, choose “Save as PDF”.</p>
        {!plan.dates.start_date && tripStart(plan) && (
          <p className="mt-2 text-xs text-slate-500">Your dates are flexible, so the calendar uses the planned start ({tripStart(plan)}). Tap “Change dates” in the chat to pick yours.</p>
        )}
      </Card>

      <Card className="p-4 lg:col-span-2">
        <SectionTitle icon={<Info size={18} />} title="Notes" />
        <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          {[...plan.data_notes, ...plan.warnings].map((note) => (
            <li key={note} className="flex gap-2"><span className="text-slate-400">•</span>{note}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

/** Google and Outlook open a filled-in event; the .ics file adds every timetable item (Apple, Outlook desktop, any app). */
function AddToCalendar({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const ready = !!tripStart(plan)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => box.current && !box.current.contains(event.target as Node) && setOpen(false)
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const ics = () => {
    try {
      downloadIcs(plan)
      toast.success('Calendar file downloaded. Open it to add every stop of the trip.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The calendar file could not be created.')
    }
    setOpen(false)
  }
  const item = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-brand-50 dark:text-slate-200 dark:hover:bg-white/5'

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!ready}
        aria-haspopup="menu"
        aria-expanded={open}
        title={ready ? 'Add this trip to your calendar' : 'Add travel dates first'}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
      >
        <CalendarPlus size={15} /> Add to calendar <ChevronDown size={14} className={clsx('transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-50 mt-2 w-64 animate-pop rounded-xl border border-slate-200 bg-white p-1.5 shadow-lift sm:left-auto sm:right-0 dark:border-white/10 dark:bg-ink-800">
          <a role="menuitem" href={googleCalendarUrl(plan)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={item}>
            <CalendarBadge color="#1a73e8" letter="G" /> Google Calendar
          </a>
          <a role="menuitem" href={outlookCalendarUrl(plan)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={item}>
            <CalendarBadge color="#0f6cbd" letter="O" /> Outlook.com
          </a>
          <button role="menuitem" onClick={ics} className={item}>
            <CalendarBadge color="#475569" letter="" /> <span>Apple / other app<span className="block text-xs font-normal text-slate-500">.ics file, every stop as an event</span></span>
          </button>
          <div className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[11px] text-slate-500 dark:border-white/10">Google and Outlook add the trip as one event with the day-by-day plan inside.</div>
        </div>
      )}
    </div>
  )
}

function CalendarBadge({ color, letter }: { color: string; letter: string }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-bold text-white" style={{ background: color }}>
      {letter || <Download size={13} />}
    </span>
  )
}
