import type { TFunction } from 'i18next'
import { ApiError } from '@/api/client'

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
 * grouping them is more honest than a misleading specific message.
 */
export function describeApiError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.message) return err.message
    return defaultMessageForStatus(err.status, t)
  }
  if (err instanceof TypeError) {
    return t('errors.network')
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

function defaultMessageForStatus(status: number, t: TFunction): string {
  if (status === 401) return t('errors.sessionExpired')
  if (status === 403) return t('errors.permissionDenied')
  if (status === 404) return t('errors.notFound')
  if (status === 409) return t('errors.conflict')
  if (status === 429) return t('errors.rateLimit')
  if (status >= 500) return t('errors.serverError')
  return t('errors.unknown')
}
