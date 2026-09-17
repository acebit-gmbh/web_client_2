import { describe, it, expect } from 'vitest'
import {
  buildTotpWrite,
  isTotpWritableType,
  normalizeBase32,
  parseOtpauth,
  TOTP_UNTOUCHED,
  validateTotpDraft,
  type TotpFormDraft,
} from './totp'

// RFC 6238 test vector, 32 characters - never a real seed.
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const SEED16 = 'JBSWY3DPEHPK3PXP'

describe('normalizeBase32', () => {
  it('upper-cases and drops whitespace anywhere', () => {
    expect(normalizeBase32(' jbsw y3dp\tehpk\n3pxp ')).toBe(SEED16)
  })

  it('drops padding from the end only', () => {
    expect(normalizeBase32('JBSWY3DP====')).toBe('JBSWY3DP')
    expect(normalizeBase32('JBSWY3DP== ==')).toBe('JBSWY3DP')
    expect(normalizeBase32('JBSW=Y3DP')).toBeNull()
  })

  it.each(['0', '1', '8', '9', '-', '+', '!', '/'])('rejects a value containing %j', (ch) => {
    expect(normalizeBase32(`JBSWY3DP${ch}EHPK3PXP`)).toBeNull()
  })

  it('returns an empty string for whitespace only', () => {
    expect(normalizeBase32('   ')).toBe('')
  })
})

describe('validateTotpDraft', () => {
  it('admits the RFC 6238 vector with the server defaults', () => {
    expect(validateTotpDraft({ secret: SEED, algorithm: 'SHA1', digits: 6, period: 30 })).toBeNull()
  })

  it.each([
    [15, 'secret'],
    [16, null],
    [128, null],
    [129, 'secret'],
  ])('secret of %i characters -> %j', (length, expected) => {
    expect(validateTotpDraft({ secret: 'A'.repeat(length) })).toBe(expected)
  })

  it('measures the secret after normalisation', () => {
    expect(validateTotpDraft({ secret: 'jbsw y3dp ehpk 3pxp ====' })).toBeNull()
    expect(validateTotpDraft({ secret: 'jbsw y3dp ehpk 3px' })).toBe('secret')
  })

  it('rejects a secret with characters outside Base32', () => {
    expect(validateTotpDraft({ secret: 'JBSW1Y3DPEHPK3PXP' })).toBe('secret')
  })

  it.each([
    ['sha1', 'algorithm'],
    ['MD5', 'algorithm'],
    ['SHA1', null],
    ['SHA256', null],
    ['SHA512', null],
  ])('algorithm %j -> %j (the form upper-cases before validating)', (algorithm, expected) => {
    expect(validateTotpDraft({ algorithm })).toBe(expected)
  })

  it.each([
    [5, 'digits'],
    [6, null],
    [8, null],
    [9, 'digits'],
    [6.5, 'digits'],
    [NaN, 'digits'],
  ])('digits %d -> %j', (digits, expected) => {
    expect(validateTotpDraft({ digits })).toBe(expected)
  })

  it.each([
    [14, 'period'],
    [15, null],
    [120, null],
    [121, 'period'],
    [30.5, 'period'],
    [NaN, 'period'],
  ])('period %d -> %j', (period, expected) => {
    expect(validateTotpDraft({ period })).toBe(expected)
  })

  it('names the first failing member in the server order', () => {
    expect(validateTotpDraft({ secret: 'short', algorithm: 'MD5', digits: 1, period: 1 })).toBe(
      'secret',
    )
    expect(validateTotpDraft({ secret: SEED, algorithm: 'MD5', digits: 1, period: 1 })).toBe(
      'algorithm',
    )
    expect(validateTotpDraft({ secret: SEED, algorithm: 'SHA1', digits: 1, period: 1 })).toBe(
      'digits',
    )
    expect(validateTotpDraft({ secret: SEED, algorithm: 'SHA1', digits: 6, period: 1 })).toBe(
      'period',
    )
  })

  it('does not judge members that are absent', () => {
    expect(validateTotpDraft({})).toBeNull()
    expect(validateTotpDraft({ digits: 8 })).toBeNull()
  })
})

describe('parseOtpauth', () => {
  it('reads a complete key URI', () => {
    expect(
      parseOtpauth(
        `otpauth://totp/Example:alice@example.com?secret=${SEED}&issuer=Example&algorithm=SHA256&digits=8&period=60`,
      ),
    ).toEqual({
      secret: SEED,
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
      label: 'alice@example.com',
      issuer: 'Example',
    })
  })

  it('leaves omitted parameters undefined so the server defaults apply', () => {
    expect(parseOtpauth(`otpauth://totp/alice?secret=${SEED}`)).toEqual({
      secret: SEED,
      label: 'alice',
      issuer: '',
    })
  })

  it('percent-decodes the secret, the label and the issuer', () => {
    const parsed = parseOtpauth(
      'otpauth://totp/Big%20Corp%3Aalice?secret=JBSW%20Y3DP%20EHPK%203PXP&issuer=Big%20Corp',
    )
    expect(parsed?.secret).toBe('JBSW Y3DP EHPK 3PXP')
    expect(normalizeBase32(parsed!.secret)).toBe(SEED16)
    expect(parsed?.issuer).toBe('Big Corp')
    expect(parsed?.label).toBe('alice')
  })

  it("reads '+' in the query as a space, which normalisation then drops", () => {
    const parsed = parseOtpauth('otpauth://totp/x?secret=JBSW+Y3DP+EHPK+3PXP')
    expect(parsed?.secret).toBe('JBSW Y3DP EHPK 3PXP')
    expect(normalizeBase32(parsed!.secret)).toBe(SEED16)
  })

  it('takes the issuer from the label prefix when there is no issuer parameter', () => {
    const parsed = parseOtpauth(`otpauth://totp/Example:alice?secret=${SEED}`)
    expect(parsed?.issuer).toBe('Example')
    expect(parsed?.label).toBe('alice')
  })

  it('prefers the issuer parameter over the label prefix', () => {
    const parsed = parseOtpauth(`otpauth://totp/Old:alice?secret=${SEED}&issuer=New`)
    expect(parsed?.issuer).toBe('New')
  })

  it('accepts an upper-case type and a lower-case algorithm', () => {
    const parsed = parseOtpauth(`  otpauth://TOTP/x?secret=${SEED}&algorithm=sha512  `)
    expect(parsed?.algorithm).toBe('SHA512')
  })

  it.each([
    ['hotp', `otpauth://hotp/x?secret=${SEED}&counter=0`],
    ['the migration export format', 'otpauth-migration://offline?data=CjEKCkhlbGxvIQ'],
    ['an unknown algorithm', `otpauth://totp/x?secret=${SEED}&algorithm=MD5`],
    ['a hyphenated algorithm name', `otpauth://totp/x?secret=${SEED}&algorithm=SHA-1`],
    ['non-integer digits', `otpauth://totp/x?secret=${SEED}&digits=6.0`],
    ['non-numeric digits', `otpauth://totp/x?secret=${SEED}&digits=six`],
    ['a negative period', `otpauth://totp/x?secret=${SEED}&period=-30`],
    ['a missing secret', 'otpauth://totp/x?issuer=Example'],
    ['an empty secret', 'otpauth://totp/x?secret='],
    ['another scheme', `https://example.com/?secret=${SEED}`],
    ['no URI at all', 'not a uri'],
    ['an empty string', ''],
  ])('fails closed on %s', (_what, uri) => {
    expect(parseOtpauth(uri)).toBeNull()
  })
})

describe('buildTotpWrite', () => {
  const stored = { algorithm: 'SHA1', digits: 6, period: 30 }
  const draft = (over: Partial<TotpFormDraft> = {}): TotpFormDraft => ({
    secret: '',
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
    ...over,
  })

  it('omits the key when untouched', () => {
    expect(buildTotpWrite(TOTP_UNTOUCHED, stored)).toBeUndefined()
    expect(buildTotpWrite(TOTP_UNTOUCHED, null)).toBeUndefined()
  })

  it('sends the literal null for a removal', () => {
    expect(buildTotpWrite({ mode: 'remove' }, stored)).toBeNull()
  })

  it('sends all four members, the secret normalised, when a secret was entered', () => {
    expect(
      buildTotpWrite(
        {
          mode: 'edit',
          draft: draft({
            secret: 'jbsw y3dp ehpk 3pxp',
            algorithm: 'SHA256',
            digits: '8',
            period: '60',
          }),
        },
        stored,
      ),
    ).toEqual({ secret: SEED16, algorithm: 'SHA256', digits: 8, period: 60 })
  })

  it('passes a secret normalisation refuses through unchanged, for validation to name', () => {
    const write = buildTotpWrite({ mode: 'edit', draft: draft({ secret: 'JBSW1Y3DP' }) }, null)
    expect(write?.secret).toBe('JBSW1Y3DP')
    expect(validateTotpDraft(write!)).toBe('secret')
  })

  it('sends the parameters without a secret when only they changed', () => {
    const write = buildTotpWrite({ mode: 'edit', draft: draft({ digits: '8' }) }, stored)
    expect(write).toEqual({ algorithm: 'SHA1', digits: 8, period: 30 })
    expect(write).not.toHaveProperty('secret')
  })

  it('never sends an empty string as the secret', () => {
    const write = buildTotpWrite(
      { mode: 'edit', draft: draft({ secret: '   ', period: '60' }) },
      stored,
    )
    expect(write).toEqual({ algorithm: 'SHA1', digits: 6, period: 60 })
    expect(write).not.toHaveProperty('secret')
  })

  it('omits the key when the parameters equal the stored ones', () => {
    expect(buildTotpWrite({ mode: 'edit', draft: draft() }, stored)).toBeUndefined()
  })

  it('omits the key when there is no secret and nothing is stored', () => {
    expect(buildTotpWrite({ mode: 'edit', draft: draft({ digits: '8' }) }, null)).toBeUndefined()
  })

  it('keeps an empty numeric field as NaN so validation names it', () => {
    const write = buildTotpWrite({ mode: 'edit', draft: draft({ secret: SEED, digits: '' }) }, null)
    expect(write?.digits).toBeNaN()
    expect(validateTotpDraft(write!)).toBe('digits')
  })
})

describe('isTotpWritableType', () => {
  it.each(['password', 'credit_card', 'license', 'banking', 'custom'] as const)(
    '%s can',
    (type) => {
      expect(isTotpWritableType(type)).toBe(true)
    },
  )

  it.each([
    'identity',
    'information',
    'document',
    'rdp',
    'putty',
    'teamviewer',
    'passkey',
  ] as const)('%s cannot', (type) => {
    expect(isTotpWritableType(type)).toBe(false)
  })
})
