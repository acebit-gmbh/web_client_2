import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { describeApiError, describeLoginError } from './apiErrors'
import { ApiError } from '@/api/client'

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
