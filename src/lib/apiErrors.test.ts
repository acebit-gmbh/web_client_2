import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import {
  describeApiError,
  describeIconError,
  describeIconUploadError,
  describeLoginError,
  describeOtpError,
  ERRCODE_ICON_ASSIGNMENT,
  ERRCODE_ICON_IMAGE,
  ERRCODE_ICON_NOT_FOUND,
  ERRCODE_ICON_QUOTA,
  ERRCODE_ICON_TOO_LARGE,
  isIconRefusal,
  isTotpWriteRefusal,
} from './apiErrors'
import { ApiError, UploadInterruptedError } from '@/api/client'
import { IconUploadAnswerError } from '@/api/icons'

// Test double for i18next's `t`. Returns the key so we can assert which
// fallback was selected without depending on locale files.
const t = ((key: string) => key) as unknown as TFunction

describe('describeLoginError', () => {
  it.each([
    [401, 4012, 'm', 'login.tfaEmailSendFailed'],
    [401, 4013, 'm', 'login.tfaEmailMissing'],
    [401, 401, 'm', 'm'],
    [403, 4012, 'm', 'm'],
    [401, 4099, 'm', 'm'],
    [401, 401, '', 'login.unexpectedError'],
    [460, 460, 'Code sent', 'Code sent'],
  ])('status %i, code %i, message %j -> %j', (status, code, message, expected) => {
    expect(describeLoginError(new ApiError(status, code, message), t)).toBe(expected)
  })
})

describe('describeOtpError', () => {
  it.each([
    [403, 4031, 'secondPassword.wrongPassword'],
    [403, 403, 'entry.oneTimeCode.notAvailable'],
    [403, 4099, 'entry.oneTimeCode.notAvailable'],
    [404, 4041, 'entry.oneTimeCode.none'],
    [404, 404, 'errors.notFound'],
    [501, 501, 'entry.oneTimeCode.unsupported'],
    [500, 500, 'entry.oneTimeCode.loadFailed'],
    [400, 4031, 'entry.oneTimeCode.loadFailed'],
  ])('status %i, code %i -> %j', (status, code, expected) => {
    expect(describeOtpError(status, code, t)).toBe(expected)
  })
})

describe('describeApiError', () => {
  describe('ApiError', () => {
    it('prefers the server message when present', () => {
      expect(
        describeApiError(new ApiError(403, 403, 'Specific server complaint'), t),
      ).toBe('Specific server complaint')
    })

    it('falls back to status-specific keys when message is empty', () => {
      expect(describeApiError(new ApiError(401, 401, ''), t)).toBe('errors.sessionExpired')
      expect(describeApiError(new ApiError(403, 403, ''), t)).toBe('errors.permissionDenied')
      expect(describeApiError(new ApiError(404, 404, ''), t)).toBe('errors.notFound')
      expect(describeApiError(new ApiError(409, 409, ''), t)).toBe('errors.conflict')
      expect(describeApiError(new ApiError(429, 429, ''), t)).toBe('errors.rateLimit')
      expect(describeApiError(new ApiError(500, 500, ''), t)).toBe('errors.serverError')
      expect(describeApiError(new ApiError(503, 503, ''), t)).toBe('errors.serverError')
      expect(describeApiError(new ApiError(418, 418, ''), t)).toBe('errors.unknown')
    })
  })

  describe('network errors', () => {
    it('classifies fetch TypeError as network', () => {
      expect(describeApiError(new TypeError('Failed to fetch'), t)).toBe('errors.network')
    })

    it('translates an interrupted XHR upload instead of showing its English message', () => {
      const err = new UploadInterruptedError()
      expect(describeApiError(err, t)).toBe('errors.uploadInterrupted')
      expect(describeApiError(err, t)).not.toBe(err.message)
    })
  })

  describe('generic errors', () => {
    it('uses err.message when present', () => {
      expect(describeApiError(new Error('something specific'), t)).toBe('something specific')
    })
    it('falls back to errors.unknown for empty message', () => {
      expect(describeApiError(new Error(''), t)).toBe('errors.unknown')
    })
  })

  describe('non-Error values', () => {
    it.each([null, undefined, 'plain string', 42, { foo: 'bar' }])(
      '%s → errors.unknown',
      (input) => {
        expect(describeApiError(input, t)).toBe('errors.unknown')
      },
    )
  })
})

describe('database icon refusals', () => {
  it('uses the sub-codes of the contract', () => {
    expect([
      ERRCODE_ICON_ASSIGNMENT,
      ERRCODE_ICON_IMAGE,
      ERRCODE_ICON_QUOTA,
      ERRCODE_ICON_NOT_FOUND,
      ERRCODE_ICON_TOO_LARGE,
    ]).toEqual([4007, 4008, 4034, 4042, 4131])
  })

  describe('describeIconError', () => {
    it.each([
      [400, 4007, 'entryForm.icon.errors.gone'],
      [400, 4008, 'entryForm.icon.errors.image'],
      [403, 4034, 'entryForm.icon.errors.quota'],
      [404, 4042, 'entryForm.icon.errors.gone'],
      [413, 4131, 'entryForm.icon.errors.tooLarge'],
      // The header-stage refusal has no sub-code; too large all the same.
      [413, 413, 'entryForm.icon.errors.tooLarge'],
    ])('status %i, code %i -> %j', (status, code, expected) => {
      expect(describeIconError(status, code, t)).toBe(expected)
    })

    it.each([
      // A code is only itself together with its own status.
      [403, 4007],
      [400, 4034],
      [400, 4042],
      [400, 4131],
      [404, 4008],
      // Not icon refusals at all.
      [400, 400],
      [400, 4001],
      [403, 403],
      [403, 4031],
      [404, 404],
      [500, 500],
    ])('status %i, code %i is left to the caller (null)', (status, code) => {
      expect(describeIconError(status, code, t)).toBeNull()
    })
  })

  describe('isIconRefusal', () => {
    it.each([
      [400, 4007],
      [400, 4008],
      [403, 4034],
      [404, 4042],
      [413, 4131],
    ])('%i / %i is explained inline, and has a message to explain it with', (status, code) => {
      expect(isIconRefusal(new ApiError(status, code, 'server text'))).toBe(true)
      expect(describeIconError(status, code, t)).not.toBeNull()
    })

    it.each([
      [403, 4007],
      [400, 4034],
      [413, 413],
      [400, 400],
      [403, 403],
      [400, 4001],
      [400, 4006],
      [403, 4033],
    ])('%i / %i keeps its toast', (status, code) => {
      expect(isIconRefusal(new ApiError(status, code, 'server text'))).toBe(false)
    })

    it('is false for anything that is not an ApiError', () => {
      expect(isIconRefusal(new TypeError('Failed to fetch'))).toBe(false)
      expect(isIconRefusal(null)).toBe(false)
    })

    it('4007 lies outside the one-time-code refusals, and those outside the icon refusals', () => {
      expect(isTotpWriteRefusal(new ApiError(400, 4007, ''))).toBe(false)
      for (const code of [4001, 4002, 4003, 4004, 4005, 4006]) {
        expect(isIconRefusal(new ApiError(400, code, ''))).toBe(false)
      }
    })
  })

  describe('describeIconUploadError', () => {
    it.each([
      [400, 4008, 'entryForm.icon.errors.image'],
      [413, 4131, 'entryForm.icon.errors.tooLarge'],
      [413, 413, 'entryForm.icon.errors.tooLarge'],
      [403, 4034, 'entryForm.icon.errors.quota'],
      // Plain 403: a mirror server (or no upload right).
      [403, 403, 'entryForm.icon.errors.readOnly'],
      // Plain 400: the name (or the body) was not accepted.
      [400, 400, 'entryForm.icon.errors.nameRefused'],
      [401, 401, 'errors.sessionExpired'],
      [429, 429, 'errors.rateLimit'],
      [500, 500, 'errors.serverError'],
      [404, 404, 'entryForm.icon.errors.uploadFailed'],
    ])('status %i, code %i -> %j', (status, code, expected) => {
      expect(describeIconUploadError(new ApiError(status, code, 'server text'), t)).toBe(expected)
    })

    it('never shows the wording of the server', () => {
      for (const [status, code] of [
        [400, 4008],
        [403, 403],
        [404, 404],
        [500, 500],
      ]) {
        expect(describeIconUploadError(new ApiError(status, code, 'server text'), t)).not.toContain(
          'server text',
        )
      }
    })

    it('says the icon was stored when only the answer was unusable', () => {
      // The POST succeeded, so "could not be uploaded" would be false: the
      // icon is in the database and counts against the quota.
      expect(describeIconUploadError(new IconUploadAnswerError(), t)).toBe(
        'entryForm.icon.errors.uploadAnswer',
      )
    })

    it('reads a network TypeError as "too large or connection lost"', () => {
      // A header-stage 413 carries no CORS headers, so fetch() rejects with
      // a TypeError exactly as it does for a lost connection.
      expect(describeIconUploadError(new TypeError('Failed to fetch'), t)).toBe(
        'entryForm.icon.errors.tooLargeOrConnection',
      )
    })

    it.each([new Error('boom'), null, 'text'])('anything else (%j) is a plain failure', (err) => {
      expect(describeIconUploadError(err, t)).toBe('entryForm.icon.errors.uploadFailed')
    })
  })
})
