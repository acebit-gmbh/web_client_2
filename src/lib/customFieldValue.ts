import type { CustomField } from '@/api/types'
import { formatCalendarDay, isCalendarDay } from './entryDates'

/*
  Server 20.0.0 sends the value of a typed custom field in the form the
  database stores it, always as a string: a `date` as the calendar day
  YYYY-MM-DD, a `decimal` with "." as its separator and no grouping, a
  `number` as its digits, a `boolean` as true or false. A value that does not
  fit its type's form is the text the server kept.
*/

const DECIMAL_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/

const decimalSeparatorCache = new Map<string, string>()

function decimalSeparator(locale: string): string {
  let separator = decimalSeparatorCache.get(locale)
  if (separator === undefined) {
    try {
      separator =
        new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
          ?.value ?? '.'
    } catch {
      separator = '.'
    }
    decimalSeparatorCache.set(locale, separator)
  }
  return separator
}

/** The user's words for a boolean field's two values, e.g. Yes and No. */
export interface BooleanWords {
  true: string
  false: string
}

/**
 * The text the detail view shows for a custom field: a date as that calendar
 * day in the user's language, a decimal with the user's decimal separator (the
 * digits as they came, never through a float), a boolean as the user's word
 * for true or false when `words` are given, every other value as it came.
 */
export function customFieldDisplay(
  field: CustomField,
  locale: string,
  words?: BooleanWords,
): string {
  const value = field.value ?? ''
  if (field.type === 'date' && isCalendarDay(value)) return formatCalendarDay(value, locale)
  if (field.type === 'boolean' && words && (value === 'true' || value === 'false')) {
    return words[value]
  }
  if (field.type === 'decimal' && DECIMAL_RE.test(value)) {
    return value.replace('.', decimalSeparator(locale))
  }
  return value
}
