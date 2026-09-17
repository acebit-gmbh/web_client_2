import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { CopyButton } from '@/components/common/CopyButton'
import { SecondPasswordPrompt } from '@/components/common/SecondPasswordPrompt'
import { getEntryOtp } from '@/api/entries'
import { ApiError } from '@/api/client'
import type { EntryOtp } from '@/api/types'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import {
  describeApiError,
  describeOtpError,
  ERRCODE_INVALID_SECOND_PASS,
  ERRCODE_NO_ONE_TIME_CODE,
} from '@/lib/apiErrors'

/**
 * A copied code is worthless once its period is over, so it leaves the
 * clipboard after 20 s whatever the user's password auto-clear setting says.
 */
const CODE_CLIPBOARD_CLEAR_MS = 20_000

/**
 * The API docs say not to use a code with `expires_in` of 2 s or less: wait
 * it out and fetch the successor - once.
 */
const ROLLOVER_THRESHOLD_S = 2

/** How often the countdown re-reads the monotonic clock. */
const TICK_MS = 250

type Phase =
  | { kind: 'masked' }
  | { kind: 'loading' }
  | { kind: 'shown'; code: string; period: number; expiresAt: number }
  | { kind: 'error'; message: string }
  | { kind: 'gone' }

const MASKED: Phase = { kind: 'masked' }
const LOADING: Phase = { kind: 'loading' }

/**
 * Groups the digits in threes for reading. The code stays a string - leading
 * zeros are part of it, and 10..16-digit codes are Password Depot's own.
 */
function groupDigits(code: string): string {
  return code.replace(/(.{3})(?=.)/g, '$1 ')
}

/**
 * When a code received now stops being valid, on the monotonic clock: a
 * wall-clock jump (NTP, resume from sleep) must not stretch or shorten a
 * code's apparent lifetime. Called from request continuations only.
 */
function expiryDeadline(expiresIn: number): number {
  return performance.now() + expiresIn * 1000
}

interface OneTimeCodeFieldProps {
  dbId: string
  entryId: string
  /** Shown in the header of the second-password prompt. */
  entryName: string
  entryType: string
}

/**
 * The entry's one-time code (Server 20.0.0+), masked until the user asks for
 * it. GET /otp is an audited read that fires "password accessed" alerts, so
 * the code is fetched on the "Show code" click only - never through a query
 * hook, whose 5-minute staleTime and refetchOnWindowFocus would turn it into
 * polling. The countdown runs on performance.now() (monotonic: a wall-clock
 * jump must not stretch a code's apparent lifetime) and the code is masked
 * again on expiry, when the tab is hidden, on entry change and on unmount.
 * Codes are never computed here - the seed never leaves the server.
 */
export function OneTimeCodeField({ dbId, entryId, entryName, entryType }: OneTimeCodeFieldProps) {
  const { t } = useTranslation()
  const secondPassword = useSecondPasswordStore((s) => s.getSecondPassword(entryId))
  const setSecondPassword = useSecondPasswordStore((s) => s.setSecondPassword)
  const clearSecondPassword = useSecondPasswordStore((s) => s.clearSecondPassword)

  // Every piece of state is tagged with the entry it belongs to, so a render
  // for another entry starts masked without an effect having to reset it.
  // The previous entry's phase (its plaintext code, if shown) is replaced
  // right here as well - React's way of resetting state on a prop change -
  // so it does not linger in state until the next update.
  const key = `${dbId}/${entryId}`
  const [state, setState] = useState<{ key: string; phase: Phase }>({ key, phase: MASKED })
  if (state.key !== key) {
    setState({ key, phase: MASKED })
  }
  const phase = state.key === key ? state.phase : MASKED
  const [remaining, setRemaining] = useState(0)
  const [promptFor, setPromptFor] = useState<string | null>(null)

  // Sequence guard for in-flight requests: a response whose number no longer
  // matches (masked, entry changed, unmounted) is dropped unseen.
  const requestSeq = useRef(0)
  const rolloverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Invalidates whatever is in flight and cancels a pending rollover refetch.
  const cancelPending = useCallback(() => {
    requestSeq.current++
    clearTimeout(rolloverTimer.current)
    rolloverTimer.current = undefined
  }, [])

  const mask = useCallback(() => {
    cancelPending()
    setState((prev) => (prev.phase === MASKED ? prev : { ...prev, phase: MASKED }))
  }, [cancelPending])

  // Entry change or unmount: nothing in flight may land, and no rollover
  // refetch may fire for an entry nobody is looking at any more.
  useEffect(() => cancelPending, [key, cancelPending])

  function accept(otp: EntryOtp, password: string | undefined, afterRollover: boolean) {
    if (otp.expires_in <= ROLLOVER_THRESHOLD_S && !afterRollover) {
      // Wait out the rest of the period and fetch the successor exactly once.
      // Never again after that: a period is at least 15 s, so the successor
      // is fresh unless the server clock is off, and looping would turn one
      // click into polling of an audited, alert-firing endpoint.
      setState({ key, phase: LOADING })
      rolloverTimer.current = setTimeout(() => {
        rolloverTimer.current = undefined
        void load(password, true)
      }, otp.expires_in * 1000)
      return
    }
    setRemaining(otp.expires_in)
    setState({
      key,
      phase: {
        kind: 'shown',
        code: otp.code,
        period: otp.period,
        expiresAt: expiryDeadline(otp.expires_in),
      },
    })
  }

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 403 && err.code === ERRCODE_INVALID_SECOND_PASS) {
      // The cached second password (if any) was rejected: drop it so nothing
      // else reuses it, and ask for a fresh one. For an entry with its own
      // second password, clearing it makes EntryDetail lock the entry and show
      // its prompt (this row unmounts). The prompt below covers the other
      // case - a link whose target is protected while the link itself is not.
      clearSecondPassword(entryId)
      setState({ key, phase: MASKED })
      setPromptFor(key)
      return
    }
    if (err instanceof ApiError && err.status === 404 && err.code === ERRCODE_NO_ONE_TIME_CODE) {
      // has_otp was stale: the seed has been removed since the list was loaded.
      setState({ key, phase: { kind: 'gone' } })
      return
    }
    const message =
      err instanceof ApiError ? describeOtpError(err.status, err.code, t) : describeApiError(err, t)
    setState({ key, phase: { kind: 'error', message } })
  }

  async function load(password: string | undefined, afterRollover: boolean) {
    const seq = ++requestSeq.current
    setState({ key, phase: LOADING })
    try {
      const otp = await getEntryOtp(dbId, entryId, password)
      if (seq !== requestSeq.current) return
      accept(otp, password, afterRollover)
    } catch (err) {
      if (seq !== requestSeq.current) return
      fail(err)
    }
  }

  // Verifies the candidate against /otp itself - the call we are after. A
  // wrong password throws 4031, which the prompt shows inline; a good one is
  // cached like EntryDetail does, so the next click needs no prompt.
  async function handleSecondPasswordSubmit(password: string) {
    const seq = ++requestSeq.current
    const otp = await getEntryOtp(dbId, entryId, password)
    if (seq !== requestSeq.current) return
    setSecondPassword(entryId, password)
    setPromptFor(null)
    accept(otp, password, false)
  }

  const shown = phase.kind === 'shown' ? phase : null

  useEffect(() => {
    if (!shown) return
    const id = setInterval(() => {
      const left = Math.ceil((shown.expiresAt - performance.now()) / 1000)
      if (left <= 0) mask()
      else setRemaining(left)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [shown, mask])

  // A code must not sit on a screen nobody is looking at: leaving the tab
  // masks it (and cancels a pending fetch). The user clicks again when back.
  const live = phase.kind === 'shown' || phase.kind === 'loading'
  useEffect(() => {
    if (!live) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') mask()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [live, mask])

  const label = t('entry.oneTimeCode.label')

  if (phase.kind === 'gone') {
    return (
      <div className="space-y-1">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </div>
        <div className="text-muted-foreground text-sm">{t('entry.oneTimeCode.none')}</div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </div>
      <div className="flex items-center gap-2">
        {/* The live region announces a code as it appears; the mask is decoration
            and must not be read out at every masking. */}
        <span className="min-w-0 truncate font-mono text-sm tracking-wider" aria-live="polite">
          {shown ? groupDigits(shown.code) : <span aria-hidden="true">••••••</span>}
        </span>
        {shown && (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {t('entry.oneTimeCode.secondsLeft', { seconds: remaining })}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {shown ? (
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={mask}
                aria-label={t('entry.oneTimeCode.hide')}
              >
                <EyeOff className="h-3 w-3" />
              </Button>
              <CopyButton value={shown.code} autoClearMs={CODE_CLIPBOARD_CLEAR_MS} />
            </>
          ) : (
            <Button
              variant="outline"
              size="xs"
              className="gap-1"
              onClick={() => void load(secondPassword, false)}
              disabled={phase.kind === 'loading'}
            >
              {phase.kind === 'loading' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
              {t('entry.oneTimeCode.show')}
            </Button>
          )}
        </div>
      </div>
      {shown && <Progress value={remaining} max={shown.period} aria-label={label} />}
      {phase.kind === 'error' && <div className="text-destructive text-xs">{phase.message}</div>}

      <SecondPasswordPrompt
        open={promptFor === key}
        onClose={() => setPromptFor(null)}
        entryName={entryName}
        entryType={entryType}
        onSubmit={handleSecondPasswordSubmit}
      />
    </div>
  )
}
