import { describe, it, expect } from 'vitest'
import { inTimeZone } from '@/test/timeZone'
import { customFieldDisplay } from './customFieldValue'
import type { CustomField } from '@/api/types'

/*
  REST dates. Server 20.0.0 sends the value of a typed custom field in the
  form the database stores it, always as a string: a date as YYYY-MM-DD, a
  decimal with "." and no grouping. The detail view shows both in the user's
  language - the date as that calendar day in every time zone - and every other
  value as it came, a value the server kept as text included.
*/

function field(type: string | undefined, value: string): CustomField {
  return { name: 'F', value, input_id: '', id: 'c.00000001', type, secret: false }
}

describe.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
  'custom field values in %s',
  (zone) => {
    inTimeZone(zone)

    it('shows a date as that calendar day', () => {
      expect(customFieldDisplay(field('date', '2029-12-31'), 'en-US')).toBe('Dec 31, 2029')
      expect(customFieldDisplay(field('date', '2029-01-01'), 'de')).toBe('1. Jan. 2029')
    })
  },
)

describe('customFieldDisplay', () => {
  it("shows a decimal with the separator of the user's language", () => {
    expect(customFieldDisplay(field('decimal', '0.50'), 'en-US')).toBe('0.50')
    expect(customFieldDisplay(field('decimal', '0.50'), 'de')).toBe('0,50')
    expect(customFieldDisplay(field('decimal', '-1234.5'), 'de')).toBe('-1234,5')
    expect(customFieldDisplay(field('decimal', '12'), 'de')).toBe('12')
  })

  it('shows a value that does not fit its type as it came', () => {
    expect(customFieldDisplay(field('date', 'soon'), 'en-US')).toBe('soon')
    expect(customFieldDisplay(field('date', '2029-02-30'), 'en-US')).toBe('2029-02-30')
    expect(customFieldDisplay(field('date', '47483'), 'en-US')).toBe('47483')
    expect(customFieldDisplay(field('decimal', '1.234,5'), 'de')).toBe('1.234,5')
    expect(customFieldDisplay(field('date', ''), 'en-US')).toBe('')
  })

  it('shows every other type as it came', () => {
    expect(customFieldDisplay(field('text', '2029-12-31'), 'en-US')).toBe('2029-12-31')
    expect(customFieldDisplay(field('number', '9007199254740993'), 'de')).toBe('9007199254740993')
    expect(customFieldDisplay(field('boolean', 'true'), 'en-US')).toBe('true')
    expect(customFieldDisplay(field(undefined, '0.50'), 'de')).toBe('0.50')
  })
})
