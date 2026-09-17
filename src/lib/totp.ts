import type { EntryType, TotpAlgorithm, TotpWrite } from '@/api/types'

/**
 * Client-side half of the one-time-code (TOTP) editor (WCL-43): parsing a
 * pasted otpauth:// link, the server's Base32 admission rule and the body
 * the entry form sends. Pure and dependency-free on purpose - nothing here
 * computes a code. The seed goes to the server write-only and the server
 * computes every code (its 10..16-digit codes are Password Depot's own), so
 * this module must never grow a HMAC.
 *
 * The rules mirror TpdOTPAuthenticator on the server so that a refusal is
 * caught before the request leaves the browser; the server still validates.
 *
 * Follow-up, not in this cut: decoding a QR image (the otpauth:// link
 * inside it is what parseOtpauth already accepts).
 */

export const TOTP_ALGORITHMS: readonly TotpAlgorithm[] = ['SHA1', 'SHA256', 'SHA512']

export const TOTP_SECRET_MIN_LENGTH = 16
export const TOTP_SECRET_MAX_LENGTH = 128
export const TOTP_DIGITS_MIN = 6
export const TOTP_DIGITS_MAX = 8
export const TOTP_PERIOD_MIN = 15
export const TOTP_PERIOD_MAX = 120

/** What the server stores when a member is omitted on create. */
export const TOTP_DEFAULTS: Readonly<Required<Omit<TotpWrite, 'secret'>>> = {
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
}

/**
 * Entry types whose one-time code can be written over REST - the types whose
 * Windows editor has the one-time-code fields. Other types answer 4006.
 */
export const TOTP_WRITABLE_TYPES: readonly EntryType[] = [
  'password',
  'credit_card',
  'license',
  'banking',
  'custom',
]

export function isTotpWritableType(type: EntryType): boolean {
  return TOTP_WRITABLE_TYPES.includes(type)
}

/** The members of the write form, in the order the server judges them. */
export type TotpField = 'secret' | 'algorithm' | 'digits' | 'period'

const BASE32_RE = /^[A-Z2-7]*$/

/**
 * The server's normalisation of a seed: letters upper-cased, whitespace
 * dropped anywhere, `=` padding dropped from the end only. Any other
 * character (an inner `=`, `0`, `1`, `8`, `9`, punctuation) makes the whole
 * value invalid - nothing is dropped silently, because a swallowed typo
 * would store a seed no authenticator app shares. Returns null when the
 * input cannot be a seed, otherwise the normalised text (possibly empty).
 */
export function normalizeBase32(input: string): string | null {
  const compact = input.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '')
  return BASE32_RE.test(compact) ? compact : null
}

function isSecretAdmissible(secret: string): boolean {
  const normalized = normalizeBase32(secret)
  return (
    normalized !== null &&
    normalized.length >= TOTP_SECRET_MIN_LENGTH &&
    normalized.length <= TOTP_SECRET_MAX_LENGTH
  )
}

export function isTotpAlgorithm(value: string): value is TotpAlgorithm {
  return (TOTP_ALGORITHMS as readonly string[]).includes(value)
}

function inIntegerRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

/**
 * Applies the server's admission rules to the members present and names
 * the first one that fails, in the server's order: secret, algorithm,
 * digits, period. Absent members are not judged - on an update the stored
 * seed is never re-validated by a parameter change, and the form's
 * params-only write carries no secret. Returns null when everything sent
 * would be admitted.
 */
export function validateTotpDraft(draft: {
  secret?: string
  algorithm?: string
  digits?: number
  period?: number
}): TotpField | null {
  if (draft.secret !== undefined && !isSecretAdmissible(draft.secret)) return 'secret'
  if (draft.algorithm !== undefined && !isTotpAlgorithm(draft.algorithm)) return 'algorithm'
  if (
    draft.digits !== undefined &&
    !inIntegerRange(draft.digits, TOTP_DIGITS_MIN, TOTP_DIGITS_MAX)
  ) {
    return 'digits'
  }
  if (
    draft.period !== undefined &&
    !inIntegerRange(draft.period, TOTP_PERIOD_MIN, TOTP_PERIOD_MAX)
  ) {
    return 'period'
  }
  return null
}

/** A key URI as an authenticator app would read it; `label`/`issuer` are for display only. */
export interface ParsedOtpauth {
  /** Percent-decoded, otherwise as given - run it through normalizeBase32 before use. */
  secret: string
  /** Present only when the link named one; the server default applies otherwise. */
  algorithm?: TotpAlgorithm
  digits?: number
  period?: number
  label: string
  issuer: string
}

const INTEGER_RE = /^\d+$/

function parseIntegerParam(value: string | null): number | null | undefined {
  if (value === null) return undefined
  return INTEGER_RE.test(value) ? Number(value) : null
}

/**
 * Reads an otpauth://totp/... key URI (the content of a setup QR code).
 * Fails closed - returns null - on anything that is not a time-based code:
 * `hotp`, the `otpauth-migration://` export format, an algorithm other than
 * SHA1/SHA256/SHA512, or `digits`/`period` that are not plain integers. A
 * counter-based or unknown setup must not be stored as a TOTP seed that
 * then produces codes the service will reject. The secret is percent-decoded
 * only (`+` reads as a space, as in any query string, and normalizeBase32
 * drops whitespace); the label and issuer are decoded for display.
 */
export function parseOtpauth(uri: string): ParsedOtpauth | null {
  let url: URL
  try {
    url = new URL(uri.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'otpauth:') return null
  // The "type" of the link sits where a host would; non-special schemes
  // keep its case, so compare case-insensitively.
  if (url.hostname.toLowerCase() !== 'totp') return null

  const params = url.searchParams
  const secret = params.get('secret')
  if (!secret) return null

  const result: ParsedOtpauth = { secret, label: '', issuer: '' }

  const algorithm = params.get('algorithm')
  if (algorithm !== null) {
    const upper = algorithm.toUpperCase()
    if (!isTotpAlgorithm(upper)) return null
    result.algorithm = upper
  }
  const digits = parseIntegerParam(params.get('digits'))
  if (digits === null) return null
  if (digits !== undefined) result.digits = digits
  const period = parseIntegerParam(params.get('period'))
  if (period === null) return null
  if (period !== undefined) result.period = period

  // Label is "Issuer:account" or just "account"; a percent-encoded colon is
  // common. The issuer parameter wins over the label prefix when both exist.
  let label: string
  try {
    label = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    label = ''
  }
  const colon = label.indexOf(':')
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : ''
  result.label = (colon >= 0 ? label.slice(colon + 1) : label).trim()
  result.issuer = (params.get('issuer') ?? labelIssuer).trim()
  return result
}

/**
 * The entry form's editing state for the one-time code. `digits` and
 * `period` are kept as the strings the user types so the inputs stay
 * editable; toTotpDraft coerces them.
 */
export interface TotpFormDraft {
  secret: string
  algorithm: TotpAlgorithm
  digits: string
  period: string
}

export type TotpEdit =
  | { mode: 'untouched' }
  | { mode: 'remove' }
  | { mode: 'edit'; draft: TotpFormDraft }

export const TOTP_UNTOUCHED: TotpEdit = { mode: 'untouched' }

/** The stored parameters an update is compared against (seedless, from `EntryTotp`). */
export interface StoredTotpParams {
  algorithm: string | null
  digits: number
  period: number
}

/** The parsed draft: `NaN` for an empty or non-numeric field so validation names it. */
export function toTotpDraft(form: TotpFormDraft): Required<TotpWrite> {
  return {
    secret: form.secret,
    algorithm: form.algorithm,
    digits: form.digits.trim() === '' ? NaN : Number(form.digits),
    period: form.period.trim() === '' ? NaN : Number(form.period),
  }
}

/**
 * Builds the `totp` member of the request body from the editing state:
 *   untouched            -> undefined (the key is omitted; JSON.stringify drops it)
 *   remove               -> null (the literal, never '')
 *   a secret was entered -> all four members, the secret normalised as the
 *                           server would store it (a value normalizeBase32
 *                           refuses is passed through so validation names it)
 *   no secret, stored    -> the three parameters only (params-only write,
 *                           the stored seed is kept), or undefined when they
 *                           equal the stored ones
 *   no secret, nothing stored -> undefined: parameters without a seed mean
 *                           nothing, and an object without secret would be
 *                           refused (4005) anyway
 * Whitespace-only counts as no secret.
 */
export function buildTotpWrite(
  edit: TotpEdit,
  stored: StoredTotpParams | null,
): TotpWrite | null | undefined {
  if (edit.mode === 'untouched') return undefined
  if (edit.mode === 'remove') return null

  const draft = toTotpDraft(edit.draft)
  const params = { algorithm: draft.algorithm, digits: draft.digits, period: draft.period }

  if (draft.secret.trim() !== '') {
    return { secret: normalizeBase32(draft.secret) ?? draft.secret, ...params }
  }
  if (!stored) return undefined
  const unchanged =
    stored.algorithm === params.algorithm &&
    stored.digits === params.digits &&
    stored.period === params.period
  return unchanged ? undefined : params
}
