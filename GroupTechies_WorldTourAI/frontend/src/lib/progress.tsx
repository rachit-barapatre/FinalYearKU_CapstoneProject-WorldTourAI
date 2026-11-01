import { BedDouble, Calculator, CalendarClock, CloudSun, MapPinned, Plane, Route, ShieldCheck, TrainFront } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import type { AgentEvent } from './types'

/** The planning steps a traveler cares about, with plain-language status lines. */
export const STEPS: { id: string; label: string; done: string; icon: ReactNode }[] = [
  { id: 'CONSTRAINT_VALIDATOR', label: 'Reality check', done: 'Days, cities and budget look workable', icon: <ShieldCheck size={17} /> },
  { id: 'FLIGHT_AGENT', label: 'Flights', done: 'Fares compared for your dates', icon: <Plane size={17} /> },
  { id: 'TRANSPORT_AGENT', label: 'Trains, buses & cabs', done: 'Road and rail options priced', icon: <TrainFront size={17} /> },
  { id: 'HOTEL_AGENT', label: 'Hotels', done: 'Rates found and ranked', icon: <BedDouble size={17} /> },
  { id: 'WEATHER_AGENT', label: 'Weather', done: 'Forecast checked for each day', icon: <CloudSun size={17} /> },
  { id: 'RECOMMENDATION_AGENT', label: 'Places to visit', done: 'Sights and restaurants picked for your interests', icon: <MapPinned size={17} /> },
  { id: 'ROUTE_AGENT', label: 'Routes', done: 'Road distances measured', icon: <Route size={17} /> },
  { id: 'BUDGET_AGENT', label: 'Packages & budget', done: 'Budget, Balanced and Premium costed', icon: <Calculator size={17} /> },
  { id: 'ITINERARY_AGENT', label: 'Day-by-day timetable', done: 'Every transfer, visit and meal scheduled', icon: <CalendarClock size={17} /> },
]

export type StepState = 'working' | 'done' | 'failed' | 'skipped'

export function stepStates(events: AgentEvent[]): Record<string, StepState> {
  const result: Record<string, StepState> = {}
  const required = events.find((e) => e.agent_id === 'COORDINATOR_AGENT' && e.message.startsWith('Required agents:'))
  const needed = required ? required.message.replace('Required agents:', '').split(',').map((s) => s.trim()) : null
  for (const step of STEPS) {
    const own = events.filter((e) => e.agent_id === step.id)
    if (needed && step.id.endsWith('_AGENT') && !needed.includes(step.id)) result[step.id] = 'skipped'
    else if (own.some((e) => e.event === 'AGENT_FAILED')) result[step.id] = 'failed'
    else if (own.some((e) => e.event === 'AGENT_COMPLETED' || e.event === 'CONSTRAINT_VIOLATION')) result[step.id] = 'done'
    else result[step.id] = 'working'
  }
  return result
}

export function useProgress() {
  const events = useStore((s) => s.events)
  const states = stepStates(events)
  const visible = STEPS.filter((step) => states[step.id] !== 'skipped')
  const finished = visible.filter((step) => states[step.id] !== 'working').length
  return { states, visible, finished, total: visible.length }
}
