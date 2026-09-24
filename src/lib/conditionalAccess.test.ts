import { describe, it, expect } from 'vitest'
import {
  isBlockingWarning,
  needsAnswer,
  pendingWarning,
  verifyLabel,
  warningIdentity,
  warningLevel,
  warningMessageText,
} from './conditionalAccess'
import type { EntryWarning } from '@/api/types'

const INFO: EntryWarning = { message: 'Read only.', level: 'info', verify_text: '' }
const CONFIRM: EntryWarning = { message: 'Production!', level: 'confirm', verify_text: '' }
const VERIFY: EntryWarning = {
  message: 'Four-eyes rule.',
  level: 'verify',
  verify_text: 'I have told my manager',
}

describe('warningLevel', () => {
  it.each(['info', 'confirm', 'verify'])('takes %s at its word', (level) => {
    expect(warningLevel({ level })).toBe(level)
  })

  it.each(['critical', 'INFO', 'Confirm', '', ' info'])(
    'treats the unknown level "%s" as verify',
    (level) => {
      expect(warningLevel({ level })).toBe('verify')
    },
  )

  it('treats a level of the wrong type as verify', () => {
    expect(warningLevel({ level: 3 as unknown as string })).toBe('verify')
    expect(warningLevel({ level: undefined as unknown as string })).toBe('verify')
  })
})

describe('isBlockingWarning', () => {
  it('blocks for confirm, verify and an unknown level', () => {
    expect(isBlockingWarning(CONFIRM)).toBe(true)
    expect(isBlockingWarning(VERIFY)).toBe(true)
    expect(isBlockingWarning({ ...CONFIRM, level: 'critical' })).toBe(true)
  })

  it('does not block for info, null or a missing key', () => {
    expect(isBlockingWarning(INFO)).toBe(false)
    expect(isBlockingWarning(null)).toBe(false)
    expect(isBlockingWarning(undefined)).toBe(false)
  })
})

describe('warningIdentity', () => {
  it('is the same for the same warning', () => {
    expect(warningIdentity(VERIFY)).toBe(warningIdentity({ ...VERIFY }))
  })

  it('changes with the message, the level and the checkbox text', () => {
    const base = warningIdentity(VERIFY)
    expect(warningIdentity({ ...VERIFY, message: 'Four-eyes rule!' })).not.toBe(base)
    expect(warningIdentity({ ...VERIFY, level: 'confirm' })).not.toBe(base)
    expect(warningIdentity({ ...VERIFY, verify_text: 'I agree' })).not.toBe(base)
  })

  it('treats an absent verify_text as empty', () => {
    expect(warningIdentity({ message: 'x', level: 'confirm' })).toBe(
      warningIdentity({ message: 'x', level: 'confirm', verify_text: '' }),
    )
  })
})

describe('warningMessageText', () => {
  it('turns CR LF into line breaks and drops the whitespace around the text', () => {
    expect(
      warningMessageText({ ...CONFIRM, message: '\r\n  First line\r\nSecond line \r\n' }),
    ).toBe('First line\nSecond line')
  })

  it('keeps markup as literal text', () => {
    expect(warningMessageText({ ...CONFIRM, message: '<b>**bold**</b>' })).toBe('<b>**bold**</b>')
  })
})

describe('verifyLabel', () => {
  it("is the entry's own text", () => {
    expect(verifyLabel(VERIFY)).toBe('I have told my manager')
  })

  it("is null when the entry sets none, so the client's own label is used", () => {
    expect(verifyLabel({ ...VERIFY, verify_text: '' })).toBeNull()
    expect(verifyLabel({ ...VERIFY, verify_text: '   ' })).toBeNull()
    expect(verifyLabel({ message: 'x', level: 'verify' })).toBeNull()
  })
})

describe('needsAnswer', () => {
  it('asks for a blocking warning until it is answered', () => {
    expect(needsAnswer(CONFIRM, [])).toBe(true)
    expect(needsAnswer(CONFIRM, [warningIdentity(CONFIRM)])).toBe(false)
  })

  it('asks again when the answered warning was a different one', () => {
    expect(needsAnswer(VERIFY, [warningIdentity(CONFIRM)])).toBe(true)
  })

  it('never asks for info, null or a missing key', () => {
    expect(needsAnswer(INFO, [])).toBe(false)
    expect(needsAnswer(null, [])).toBe(false)
    expect(needsAnswer(undefined, [])).toBe(false)
  })
})

describe('pendingWarning', () => {
  it("asks about the listing's warning first, before anything was read", () => {
    expect(pendingWarning(CONFIRM, undefined, [])).toBe(CONFIRM)
    expect(pendingWarning(CONFIRM, VERIFY, [])).toBe(CONFIRM)
  })

  it('asks about a blocking warning the listing did not have', () => {
    expect(pendingWarning(null, VERIFY, [])).toBe(VERIFY)
    expect(pendingWarning(undefined, CONFIRM, [])).toBe(CONFIRM)
    expect(pendingWarning(INFO, CONFIRM, [])).toBe(CONFIRM)
  })

  it('asks again when the entry as read carries a different blocking warning', () => {
    expect(pendingWarning(CONFIRM, VERIFY, [warningIdentity(CONFIRM)])).toBe(VERIFY)
  })

  it('asks nothing once both are answered, and nothing for info or none', () => {
    const both = [warningIdentity(CONFIRM), warningIdentity(VERIFY)]
    expect(pendingWarning(CONFIRM, VERIFY, both)).toBeNull()
    expect(pendingWarning(CONFIRM, CONFIRM, [warningIdentity(CONFIRM)])).toBeNull()
    expect(pendingWarning(CONFIRM, null, [warningIdentity(CONFIRM)])).toBeNull()
    expect(pendingWarning(INFO, INFO, [])).toBeNull()
    expect(pendingWarning(null, null, [])).toBeNull()
    expect(pendingWarning(undefined, undefined, [])).toBeNull()
  })
})
