// Display formatting for the admin console. All timestamps are rendered in the
// configured business timezone (Asia/Kolkata) regardless of the viewer's clock.

export const IST_TIMEZONE = 'Asia/Kolkata'

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const monthKeyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIMEZONE, year: 'numeric', month: '2-digit' })
const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const dateFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })
const hourFormatter = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false })

/** Calendar day key (YYYY-MM-DD) for a timestamp, in IST. */
export function istDayKey(iso: string | Date): string {
  return dayKeyFormatter.format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** Month key (YYYY-MM) for a timestamp, in IST. */
export function istMonthKey(iso: string | Date): string {
  return monthKeyFormatter.format(typeof iso === 'string' ? new Date(iso) : iso)
}

export function formatIstDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}

export function formatIstDate(iso: string): string {
  return dateFormatter.format(new Date(iso))
}

export function formatIstTime(iso: string): string {
  return timeFormatter.format(new Date(iso))
}

/** "14:32" for a raw timestamp passed as ms since epoch — used for hourly chart axes. */
export function formatHourLabel(ms: number): string {
  return hourFormatter.format(new Date(ms))
}

/** Short human label for a YYYY-MM-DD day key, e.g. "24 Oct". */
export function formatDayKeyShort(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, date)))
}

/** Long label for a YYYY-MM-DD day key, e.g. "24 Oct 2026". */
export function formatDayKeyLong(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, date)))
}

export function formatNumber(value: number, locale = 'en-IN', maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)
}

/** Compact display: 1.2K / 3.4M. */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(value)
}

export function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value)
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value >= 0 ? '' : ''}${value.toFixed(fractionDigits)}%`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function relativeTime(iso: string, now = Date.now()): string {
  const delta = now - new Date(iso).getTime()
  const minutes = Math.round(delta / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/** Signed percentage change between two numbers, e.g. +12.4. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null
  return ((current - previous) / previous) * 100
}

/** Day keys from today (IST) going back `days - 1` days, oldest first. */
export function recentDayKeys(days: number, from = new Date()): string[] {
  const today = istDayKey(from)
  const [year, month, date] = today.split('-').map(Number)
  const keys: string[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const d = new Date(Date.UTC(year, month - 1, date - offset))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`)
  }
  return keys
}

/** Milliseconds for the start of an IST day (00:00 IST) as a UTC timestamp. */
export function istDayStartMs(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  // IST is UTC+5:30 with no DST, so 00:00 IST is 18:30 UTC of the previous day.
  return Date.UTC(year, month - 1, date) - 5.5 * 3600_000
}

/** The next occurrence of `clockTime` ("HH:MM" IST) after `from`. */
export function nextIstOccurrence(clockTime: string, from = new Date()): Date {
  const [hours, minutes] = clockTime.split(':').map(Number)
  const dayStart = istDayStartMs(istDayKey(from))
  let candidate = dayStart + (hours * 60 + minutes) * 60_000
  if (candidate <= from.getTime()) candidate += 24 * 3600_000
  return new Date(candidate)
}

export function addDaysToDayKey(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, date + delta))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
