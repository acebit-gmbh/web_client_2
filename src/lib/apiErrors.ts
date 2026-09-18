import type { TFunction } from 'i18next'
import { ApiError, UploadInterruptedError } from '@/api/client'
import { IconUploadAnswerError } from '@/api/icons'
import type { TotpField } from '@/lib/totp'

/**
 * Classifies a thrown value into a user-facing message. The PD Server's own
 * error message is preferred when present (it's typically already in the
 * user's language and matches the server's vocabulary); otherwise we fall
 * back to a generic localized hint based on the HTTP status.
 *
 * Exception: `describeLoginError` maps the login sub-codes 4012/4013 to
 * localized text. The server's message is in the server's configured
 * language, not the browser's, and those two conditions need a stable
 * "contact your administrator" wording (the Android client does the same).
 *
 * Network-layer failures (`fetch()` throwing TypeError) become a single
 * "check your connection / certificate" message — browsers do not expose
 * enough detail to differentiate offline / DNS / CORS / TLS reliably, so
 * grouping them is more honest than a misleading specific message. An XHR
 * upload that dies the same way is an UploadInterruptedError and gets its
 * own wording: the server was reachable a moment ago (the entry was just
 * created), so "could not reach the server" would mislead.
 */
export function describeApiError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.message) return err.message
    return defaultMessageForStatus(err.status, t)
  }
  if (err instanceof TypeError) {
    return t('errors.network')
  }
  if (err instanceof UploadInterruptedError) {
    return t('errors.uploadInterrupted')
  }
  if (err instanceof Error) {
    return err.message || t('errors.unknown')
  }
  return t('errors.unknown')
}

/** PD Server 20+: HTTP 401 sub-codes from POST /auth/login. */
export const ERRCODE_2FA_EMAIL_SEND_FAILED = 4012
export const ERRCODE_2FA_EMAIL_MISSING = 4013

/**
 * Login-form message. Status is checked before code; a plain 401 is never
 * turned into "invalid credentials", and an unknown sub-code keeps the
 * server's neutral message.
 */
export function describeLoginError(err: ApiError, t: TFunction): string {
  if (err.status === 401) {
    if (err.code === ERRCODE_2FA_EMAIL_SEND_FAILED) return t('login.tfaEmailSendFailed')
    if (err.code === ERRCODE_2FA_EMAIL_MISSING) return t('login.tfaEmailMissing')
  }
  return err.message || t('login.unexpectedError')
}

/** HTTP 403 sub-code: wrong or missing second password (all server versions). */
export const ERRCODE_INVALID_SECOND_PASS = 4031
/** PD Server 20+: HTTP 404 sub-code from GET /entries/{id}/otp - the entry exists but has no one-time code. */
export const ERRCODE_NO_ONE_TIME_CODE = 4041

/**
 * Message for a failed one-time-code read. Status first, then code, never
 * the server's message: the same neutral wording is wanted whatever language
 * the server runs in, and a plain 403 (no permission, sealed, API token)
 * must read as "not for you" rather than hint at why. 4031 is normally
 * answered by prompting for the second password before this is shown.
 */
export function describeOtpError(status: number, code: number, t: TFunction): string {
  if (status === 403) {
    return code === ERRCODE_INVALID_SECOND_PASS
      ? t('secondPassword.wrongPassword')
      : t('entry.oneTimeCode.notAvailable')
  }
  if (status === 404) {
    return code === ERRCODE_NO_ONE_TIME_CODE ? t('entry.oneTimeCode.none') : t('errors.notFound')
  }
  if (status === 501) return t('entry.oneTimeCode.unsupported')
  return t('entry.oneTimeCode.loadFailed')
}

/** PD Server 20+: HTTP 400 sub-codes for a refused `totp` write, first failing member in server order. */
export const ERRCODE_TOTP_SECRET = 4001
export const ERRCODE_TOTP_ALGORITHM = 4002
export const ERRCODE_TOTP_DIGITS = 4003
export const ERRCODE_TOTP_PERIOD = 4004
/** `{}`, an unknown member, a wrong JSON type, or no `secret` where one is required. */
export const ERRCODE_TOTP_SHAPE = 4005
/** The entry's type (after the request) cannot carry a one-time code written over REST. */
export const ERRCODE_TOTP_ENTRY_TYPE = 4006
/** PD Server 20+: HTTP 403 sub-code - a `totp` update needs read permission on the entry. */
export const ERRCODE_TOTP_READ_REQUIRED = 4033

/** The write-form member a refusal names, for highlighting the input; null for the others. */
export function totpRefusedField(status: number, code: number): TotpField | null {
  if (status !== 400) return null
  switch (code) {
    case ERRCODE_TOTP_SECRET:
      return 'secret'
    case ERRCODE_TOTP_ALGORITHM:
      return 'algorithm'
    case ERRCODE_TOTP_DIGITS:
      return 'digits'
    case ERRCODE_TOTP_PERIOD:
      return 'period'
    default:
      return null
  }
}

/**
 * Message for a `totp` write the server refused, or null when the error is
 * not one of the one-time-code refusals (the caller falls back to its usual
 * handling). Status first, then code, never the server's message: the
 * wording must be the browser's language and must never echo anything the
 * user typed. A plain 403 (no update permission, sealed) and 4031 are not
 * TOTP-specific and are left to the existing flows.
 *
 * `secretSent` says whether the request carried a `secret`: 4001 answered
 * to a parameter-only change means the stored seed (which the user never
 * saw) no longer produces a code, not that an empty input is malformed.
 */
export function describeTotpWriteError(
  status: number,
  code: number,
  t: TFunction,
  secretSent = true,
): string | null {
  if (status === 400) {
    if (code === ERRCODE_TOTP_SECRET && !secretSent) {
      return t('entryForm.oneTimeCode.errors.storedSecret')
    }
    const field = totpRefusedField(status, code)
    if (field) return t(`entryForm.oneTimeCode.errors.${field}`)
    if (code === ERRCODE_TOTP_SHAPE) return t('entryForm.oneTimeCode.errors.shape')
    if (code === ERRCODE_TOTP_ENTRY_TYPE) return t('entryForm.oneTimeCode.errors.entryType')
    return null
  }
  if (status === 403 && code === ERRCODE_TOTP_READ_REQUIRED) {
    return t('entryForm.oneTimeCode.errors.readRequired')
  }
  return null
}

/** True for an error the entry form explains inline itself (see describeTotpWriteError). */
export function isTotpWriteRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.status === 400)
    return err.code >= ERRCODE_TOTP_SECRET && err.code <= ERRCODE_TOTP_ENTRY_TYPE
  return err.status === 403 && err.code === ERRCODE_TOTP_READ_REQUIRED
}

/**
 * PD Server 20+: database-icon sub-codes. Each is only ever sent with its own
 * status, so every check below pairs the two.
 */
/** HTTP 400 on an entry write: `image_*` do not name a usable icon; nothing was written. */
export const ERRCODE_ICON_ASSIGNMENT = 4007
/** HTTP 400 on an icon upload: `data` is not a usable PNG. */
export const ERRCODE_ICON_IMAGE = 4008
/** HTTP 403 on an icon upload: the database's slot or byte quota is reached. */
export const ERRCODE_ICON_QUOTA = 4034
/** HTTP 404 on an icon read: no usable icon with that id in this database. */
export const ERRCODE_ICON_NOT_FOUND = 4042
/** HTTP 413 on an icon upload: bytes, pixels or the stored record are over the limit. */
export const ERRCODE_ICON_TOO_LARGE = 4131

/**
 * Message for a refusal that is about a database icon, or null when the
 * error is not one (the caller falls back to its usual handling). Status
 * first, then code, never the server's message: the wording must be the
 * browser's language, as for the one-time-code refusals.
 *
 * A 413 is "too large" whatever its code: besides 413/4131 there is the
 * plain 413 of the server's header stage, which a same-origin deployment
 * gets to see (cross-origin it has no CORS headers - see
 * describeIconUploadError).
 */
export function describeIconError(status: number, code: number, t: TFunction): string | null {
  if (status === 413) return t('entryForm.icon.errors.tooLarge')
  if (status === 400) {
    if (code === ERRCODE_ICON_ASSIGNMENT) return t('entryForm.icon.errors.gone')
    if (code === ERRCODE_ICON_IMAGE) return t('entryForm.icon.errors.image')
    return null
  }
  if (status === 403 && code === ERRCODE_ICON_QUOTA) return t('entryForm.icon.errors.quota')
  if (status === 404 && code === ERRCODE_ICON_NOT_FOUND) return t('entryForm.icon.errors.gone')
  return null
}

/**
 * True for an error the entry form (or the icon picker) explains inline
 * itself, so the generic toast stays away (see describeIconError). On an
 * entry write that is 400/4007; the other pairs belong to the icon routes
 * and are listed so the two functions cannot drift apart.
 */
export function isIconRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  switch (err.status) {
    case 400:
      return err.code === ERRCODE_ICON_ASSIGNMENT || err.code === ERRCODE_ICON_IMAGE
    case 403:
      return err.code === ERRCODE_ICON_QUOTA
    case 404:
      return err.code === ERRCODE_ICON_NOT_FOUND
    case 413:
      return err.code === ERRCODE_ICON_TOO_LARGE
    default:
      return false
  }
}

/**
 * Message for a failed icon upload - always one, the picker shows it inline.
 *
 * A `fetch()` TypeError gets its own wording here: a request body the
 * server's header stage refuses (HTTP 413) is answered WITHOUT CORS headers
 * and the connection is closed, so a cross-origin browser reports exactly
 * what it reports for a lost connection. The client keeps its uploads far
 * below that limit, so "too large or connection lost" is the honest hint.
 *
 * A plain 403 is the mirror refusal (a mirror server answers every write
 * with it) or a missing upload right; a plain 400 means the name or the
 * body was not accepted - the name is the only part the user typed.
 */
export function describeIconUploadError(err: unknown, t: TFunction): string {
  // The upload itself succeeded; only the answer was unusable. Saying "could
  // not be uploaded" would be false - the icon is in the database and counts
  // against the quota - so this one gets its own wording.
  if (err instanceof IconUploadAnswerError) return t('entryForm.icon.errors.uploadAnswer')
  if (err instanceof ApiError) {
    const specific = describeIconError(err.status, err.code, t)
    if (specific) return specific
    if (err.status === 400) return t('entryForm.icon.errors.nameRefused')
    if (err.status === 401) return t('errors.sessionExpired')
    if (err.status === 403) return t('entryForm.icon.errors.readOnly')
    if (err.status === 429) return t('errors.rateLimit')
    if (err.status >= 500) return t('errors.serverError')
    return t('entryForm.icon.errors.uploadFailed')
  }
  if (err instanceof TypeError) return t('entryForm.icon.errors.tooLargeOrConnection')
  return t('entryForm.icon.errors.uploadFailed')
}

function defaultMessageForStatus(status: number, t: TFunction): string {
  if (status === 401) return t('errors.sessionExpired')
  if (status === 403) return t('errors.permissionDenied')
  if (status === 404) return t('errors.notFound')
  if (status === 409) return t('errors.conflict')
  if (status === 429) return t('errors.rateLimit')
  if (status >= 500) return t('errors.serverError')
  return t('errors.unknown')
}
