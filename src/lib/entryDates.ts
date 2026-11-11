/**
 * The calendar days of an entry: `expires_at`, `license.purchase_date` and
 * `identity.birth_date` name a day, not an instant. Server 20.0.0 answers each
 * as midnight UTC of its day (`2029-12-31T00:00:00.000Z`) on a server in any
 * time zone, and takes the date part of a written value as written. The client
 * therefore reads, shows and compares the day by the value's date part in UTC -
 * never converted to the user's local time, which would show the day before
 * west of UTC - and sends a picked day as midnight UTC of that day.
 */

const CALENDAR_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const VALID_THRU_RE = /^(0[1-9]|1[0-2])\/(\d{4})$/

/** The years a credit card's Valid Thru may name, as the server takes it. */
export const VALID_THRU_YEAR_FIRST = 1950
export const VALID_THRU_YEAR_LAST = 2199

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function dayText(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

/** The `Date` at midnight UTC of a calendar day `YYYY-MM-DD`, or null for a text that names no day. */
function utcMidnightOf(day: string): Date | null {
  const m = CALENDAR_DAY_RE.exec(day)
  if (!m) return null
  const [year, month, date] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(2000, month - 1, date))
  d.setUTCFullYear(year)
  // a day the month does not have (2029-02-30) rolls over: no such day
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== date)
    return null
  return d
}

/** Whether a text is a calendar day `YYYY-MM-DD` that exists. */
export function isCalendarDay(text: string): boolean {
  return utcMidnightOf(text) !== null
}

/**
 * The calendar day `YYYY-MM-DD` an ISO 8601 value names: its date in UTC
 * (`2029-12-31T00:00:00.000Z` and `2029-12-31` are 31 December 2029); null
 * for no value and for a value that is no date.
 */
export function calendarDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  if (CALENDAR_DAY_RE.test(iso)) return isCalendarDay(iso) ? iso : null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const year = d.getUTCFullYear()
  if (year < 1 || year > 9999) return null
  return dayText(year, d.getUTCMonth() + 1, d.getUTCDate())
}

/** The user's own calendar day of the moment `now`, in the local time zone. */
export function localDayOf(now: Date): string {
  return dayText(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** A calendar day for display, e.g. "Dec 31, 2029" - that day in every time zone; '' for no date. */
export function formatCalendarDay(iso: string, locale: string): string {
  const day = calendarDayOf(iso)
  const d = day ? utcMidnightOf(day) : null
  if (!d) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

/**
 * True once the calendar day has passed for the user: the day lies before the
 * user's own day today. A card valid through 12/2029 expires on 31 December
 * 2029 and is expired from 1 January 2030 on, wherever the user is.
 */
export function isCalendarDayPast(iso: string, now: Date = new Date()): boolean {
  const day = calendarDayOf(iso)
  return day !== null && day < localDayOf(now)
}

/** The value a write sends for a day picked as `YYYY-MM-DD`: midnight UTC of that day. */
export function calendarDayToWire(day: string): string {
  // a date input gives a calendar day or nothing; anything else goes as it is
  // and the server answers 400 for it rather than this client guessing a day
  return isCalendarDay(day) ? `${day}T00:00:00.000Z` : day
}

/** Valid Thru as the server takes it: exactly MM/YYYY, a month 01 to 12 and a year 1950 to 2199. */
export function isValidThru(value: string): boolean {
  const m = VALID_THRU_RE.exec(value)
  if (!m) return false
  const year = Number(m[2])
  return year >= VALID_THRU_YEAR_FIRST && year <= VALID_THRU_YEAR_LAST
}
