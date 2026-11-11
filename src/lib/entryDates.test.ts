import { describe, it, expect } from 'vitest'
import { inTimeZone } from '@/test/timeZone'
import {
  calendarDayOf,
  calendarDayToWire,
  formatCalendarDay,
  isCalendarDayPast,
  isValidThru,
} from './entryDates'

/*
  REST dates. Server 20.0.0 answers an entry's expires_at (and a licence's
  purchase_date, an identity's birth_date) as midnight UTC of the day it names,
  whatever the server's time zone, and takes the date part of a written value
  as written. The client reads, shows and compares the day by its date part in
  UTC, and sends a picked day as midnight UTC - in every time zone of the user.
  Each suite runs under a zone far west, far east and at UTC (this test process
  only).
*/

const ZONES = ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']

describe.each(ZONES)('calendar days in %s', (zone) => {
  inTimeZone(zone)

  it('reads the day of a value as its date part in UTC', () => {
    expect(calendarDayOf('2029-12-31T00:00:00.000Z')).toBe('2029-12-31')
    expect(calendarDayOf('2029-12-31')).toBe('2029-12-31')
    expect(calendarDayOf('2028-02-29T00:00:00.000Z')).toBe('2028-02-29')
  })

  it('has no day for no value and for a value that is no date', () => {
    expect(calendarDayOf(null)).toBeNull()
    expect(calendarDayOf(undefined)).toBeNull()
    expect(calendarDayOf('')).toBeNull()
    expect(calendarDayOf('soon')).toBeNull()
  })

  it('shows the day itself, never the day before or after', () => {
    expect(formatCalendarDay('2029-12-31T00:00:00.000Z', 'en-US')).toBe('Dec 31, 2029')
    expect(formatCalendarDay('2029-01-01T00:00:00.000Z', 'en-US')).toBe('Jan 1, 2029')
    expect(formatCalendarDay('soon', 'en-US')).toBe('')
  })

  it("counts a day as past once the user has left it, by the user's own calendar", () => {
    const day = '2029-12-31T00:00:00.000Z'
    // the user's local clock: late on that day, and early the next morning
    expect(isCalendarDayPast(day, new Date(2029, 11, 31, 23, 30))).toBe(false)
    expect(isCalendarDayPast(day, new Date(2029, 11, 31, 0, 5))).toBe(false)
    expect(isCalendarDayPast(day, new Date(2030, 0, 1, 0, 30))).toBe(true)
    expect(isCalendarDayPast(day, new Date(2029, 11, 30, 12, 0))).toBe(false)
    expect(isCalendarDayPast('soon', new Date(2030, 0, 1))).toBe(false)
  })

  it('sends a picked day as midnight UTC of that day', () => {
    expect(calendarDayToWire('2029-12-31')).toBe('2029-12-31T00:00:00.000Z')
    expect(calendarDayToWire('1990-05-15')).toBe('1990-05-15T00:00:00.000Z')
  })

  it('gives back the day it read', () => {
    const answered = '2029-12-31T00:00:00.000Z'
    expect(calendarDayToWire(calendarDayOf(answered) ?? '')).toBe(answered)
  })
})

describe('isValidThru', () => {
  it.each(['12/2029', '01/1950', '12/2199', '02/2028'])('takes %s', (value) => {
    expect(isValidThru(value)).toBe(true)
  })

  it.each([
    '12/1949',
    '12/2200',
    '13/2029',
    '00/2029',
    '1/2029',
    '12/29',
    '12-2029',
    '109575',
    '12/2029 ',
    '',
  ])('refuses %j, as the server does', (value) => {
    expect(isValidThru(value)).toBe(false)
  })
})
