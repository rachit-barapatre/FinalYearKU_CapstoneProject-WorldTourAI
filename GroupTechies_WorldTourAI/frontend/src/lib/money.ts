// Prices arrive in USD; the plan carries the traveler's currency and today's rate.

export interface Display {
  currency: string
  rate: number
}

export function formatMoney(usd: number | null | undefined, display: Display, approx = false): string {
  if (typeof usd !== 'number' || Number.isNaN(usd)) return 'n/a'
  const value = usd * (display.rate || 1)
  const locale = display.currency === 'INR' ? 'en-IN' : 'en-US'
  let text: string
  try {
    text = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: display.currency || 'USD',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    text = `${display.currency} ${Math.round(value).toLocaleString()}`
  }
  return (approx ? '~' : '') + text
}

/** Amount the user typed, already in their currency (no conversion). */
export function formatLocal(amount: number | null | undefined, currency: string | null | undefined): string {
  return formatMoney(amount, { currency: currency || 'USD', rate: 1 })
}

/** Backend text marks USD amounts as {money:12.50}; show them in the traveler's currency. */
export function fillMoney(text: string | null | undefined, display: Display): string {
  return (text || '').replace(/\{money:([0-9.]+)\}/g, (_, amount: string) => formatMoney(Number(amount), display, true))
}

export function hhmm(minute: number | null | undefined): string {
  if (typeof minute !== 'number') return '--:--'
  const m = ((minute % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function clockFromIso(value: string | null | undefined): string {
  if (!value) return '--:--'
  const text = String(value)
  return text.includes('T') ? text.split('T')[1].slice(0, 5) : text.slice(-5)
}

export function duration(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number') return ''
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export function prettyDate(value: string | null | undefined, withYear = false): string {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
}
