// A plan shown read-only (a shared trip, or an older version in History): choices are visible but
// cannot be changed, and nothing touches the planner the visitor may have open.
import { createContext, useContext } from 'react'
import { useStore } from '../../store'

export const PlanReadOnly = createContext(false)
export const usePlanReadOnly = () => useContext(PlanReadOnly)

const noop = () => undefined

/** A planner action, or a no-op when the plan is read-only. */
export function usePlanAction<K extends 'choosePackage' | 'chooseTransport' | 'chooseHotel' | 'resetSelection'>(name: K) {
  const readOnly = usePlanReadOnly()
  const action = useStore((s) => s[name])
  return (readOnly ? noop : action) as typeof action
}
