import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, KeyRound, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import type { EntryTotp } from '@/api/types'
import {
  isTotpAlgorithm,
  parseOtpauth,
  TOTP_ALGORITHMS,
  TOTP_DEFAULTS,
  TOTP_DIGITS_MAX,
  TOTP_DIGITS_MIN,
  TOTP_PERIOD_MAX,
  TOTP_PERIOD_MIN,
  TOTP_UNTOUCHED,
  validateTotpDraft,
  type TotpEdit,
  type TotpField,
  type TotpFormDraft,
} from '@/lib/totp'

const OTPAUTH_SCHEME_RE = /^otpauth(-migration)?:\/\//i

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/**
 * The draft a "Replace" starts from: the stored parameters pulled into the
 * accepted range (a non-conforming entry is repaired by saving), the server
 * defaults otherwise. The secret is always empty - it is never returned.
 */
function initialDraft(stored: EntryTotp | undefined): TotpFormDraft {
  const algorithm = stored?.algorithm
  return {
    secret: '',
    algorithm: algorithm && isTotpAlgorithm(algorithm) ? algorithm : TOTP_DEFAULTS.algorithm,
    digits: String(clamp(stored?.digits, TOTP_DIGITS_MIN, TOTP_DIGITS_MAX, TOTP_DEFAULTS.digits)),
    period: String(clamp(stored?.period, TOTP_PERIOD_MIN, TOTP_PERIOD_MAX, TOTP_DEFAULTS.period)),
  }
}

const WARNING_CLASS =
  'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'

interface TotpSectionProps {
  /** The loaded entry's seedless settings when editing; undefined when creating. */
  stored?: EntryTotp
  value: TotpEdit
  onChange: (next: TotpEdit) => void
  /** The member a validation or server refusal named; highlights that input. */
  invalidField?: TotpField | null
}

/**
 * One-time-code editor inside the entry form (Server 20.0.0+, WCL-43). The
 * server never returns a seed, so the editor shows only the stored
 * parameters and every change of the seed means typing or pasting a whole
 * new one: the secret input is write-only and never pre-filled. The parent
 * owns the editing state (untouched / remove / edit) and turns it into the
 * request body; this component only renders it. No code is ever computed
 * here. Decoding a setup QR image is a follow-up - today the otpauth://
 * link inside it is pasted.
 */
export function TotpSection({ stored, value, onChange, invalidField }: TotpSectionProps) {
  const { t } = useTranslation()
  const hasStored = stored?.state === 'set' || stored?.state === 'invalid'

  const [reveal, setReveal] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState(false)
  // Set while the parameters come from a pasted link: they are locked to what
  // the service published. Editing the secret by hand unlocks them again.
  const [fromUri, setFromUri] = useState<{ issuer: string; label: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  function startEdit() {
    setReveal(false)
    setPasteText('')
    setPasteError(false)
    setFromUri(null)
    onChange({ mode: 'edit', draft: initialDraft(stored) })
  }

  function discardEdit() {
    setReveal(false)
    setPasteText('')
    setPasteError(false)
    setFromUri(null)
    onChange(TOTP_UNTOUCHED)
  }

  function updateDraft(patch: Partial<TotpFormDraft>) {
    if (value.mode !== 'edit') return
    onChange({ mode: 'edit', draft: { ...value.draft, ...patch } })
  }

  /**
   * Routes pasted or typed text: an otpauth:// link fills the secret and
   * locks the parameters to the link's; anything else is taken as the bare
   * secret. A link that is not a time-based code is refused, not guessed at.
   */
  function applyText(text: string) {
    const trimmed = text.trim()
    setPasteText('')
    if (!trimmed || value.mode !== 'edit') return
    if (OTPAUTH_SCHEME_RE.test(trimmed)) {
      const parsed = parseOtpauth(trimmed)
      if (!parsed) {
        setPasteError(true)
        return
      }
      setPasteError(false)
      // A link whose digits or period the server would refuse is filled in
      // but not locked: the value must stay editable when the form names it
      // on save, rather than flagged on a disabled input.
      const admissible = validateTotpDraft({ digits: parsed.digits, period: parsed.period }) === null
      setFromUri(admissible ? { issuer: parsed.issuer, label: parsed.label } : null)
      onChange({
        mode: 'edit',
        draft: {
          secret: parsed.secret,
          algorithm: parsed.algorithm ?? TOTP_DEFAULTS.algorithm,
          digits: String(parsed.digits ?? TOTP_DEFAULTS.digits),
          period: String(parsed.period ?? TOTP_DEFAULTS.period),
        },
      })
      return
    }
    setPasteError(false)
    setFromUri(null)
    updateDraft({ secret: trimmed })
  }

  const title = (
    <div className="flex items-center gap-2 text-sm font-medium">
      <KeyRound className="text-muted-foreground h-4 w-4" aria-hidden="true" />
      {t('entryForm.oneTimeCode.title')}
    </div>
  )

  if (value.mode === 'remove') {
    return (
      <div className="space-y-2">
        {title}
        <p className={WARNING_CLASS}>{t('entryForm.oneTimeCode.removePending')}</p>
        <Button type="button" variant="ghost" size="xs" onClick={discardEdit}>
          {t('entryForm.oneTimeCode.keep')}
        </Button>
      </div>
    )
  }

  if (value.mode === 'untouched') {
    return (
      <div className="space-y-2">
        {title}
        {hasStored && stored ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                {t('entryForm.oneTimeCode.storedSummary', {
                  algorithm: stored.algorithm ?? t('entryForm.oneTimeCode.unknownAlgorithm'),
                  digits: stored.digits ?? '?',
                  period: stored.period ?? '?',
                })}
              </span>
              <div className="ml-auto flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="xs" onClick={startEdit}>
                  {t('entryForm.oneTimeCode.replace')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setConfirmRemove(true)}
                >
                  {t('entryForm.oneTimeCode.remove')}
                </Button>
              </div>
            </div>
            {stored.state === 'invalid' && (
              <p className={WARNING_CLASS}>{t('entryForm.oneTimeCode.invalidNotice')}</p>
            )}
            {stored.conforming === false && (
              <p className={WARNING_CLASS}>{t('entryForm.oneTimeCode.nonConformingNotice')}</p>
            )}
            <ConfirmDialog
              open={confirmRemove}
              onClose={() => setConfirmRemove(false)}
              onConfirm={() => onChange({ mode: 'remove' })}
              title={t('entryForm.oneTimeCode.removeTitle')}
              description={t('entryForm.oneTimeCode.removeDesc')}
              confirmLabel={t('entryForm.oneTimeCode.remove')}
              destructive
            />
          </>
        ) : (
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={startEdit}>
            <Plus className="h-3.5 w-3.5" />
            {t('entryForm.oneTimeCode.add')}
          </Button>
        )}
      </div>
    )
  }

  const { draft } = value
  const source = [fromUri?.issuer, fromUri?.label].filter(Boolean).join(' – ')
  const pasteStatus = pasteError
    ? t('entryForm.oneTimeCode.pasteInvalid')
    : fromUri
      ? source
        ? t('entryForm.oneTimeCode.filledFrom', { source })
        : t('entryForm.oneTimeCode.filledFromLink')
      : t('entryForm.oneTimeCode.pasteHint')

  return (
    <div className="space-y-3">
      {title}
      {hasStored && stored?.conforming === false && (
        <p className={WARNING_CLASS}>{t('entryForm.oneTimeCode.nonConformingNotice')}</p>
      )}

      <div className="space-y-1">
        <Label className="text-xs" htmlFor="totp-paste">
          {t('entryForm.oneTimeCode.paste')}
        </Label>
        <Input
          id="totp-paste"
          value={pasteText}
          placeholder={t('entryForm.oneTimeCode.pastePlaceholder')}
          onChange={(e) => setPasteText(e.target.value)}
          onPaste={(e) => {
            e.preventDefault()
            applyText(e.clipboardData.getData('text'))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyText(pasteText)
            }
          }}
          onBlur={() => applyText(pasteText)}
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
        />
        <p className={`text-xs ${pasteError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {pasteStatus}
        </p>
      </div>

      <div className="space-y-1">
        <Label className="text-xs" htmlFor="totp-secret">
          {t('entryForm.oneTimeCode.secret')}
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id="totp-secret"
            type={reveal ? 'text' : 'password'}
            value={draft.secret}
            placeholder={
              hasStored
                ? t('entryForm.oneTimeCode.secretPlaceholderKeep')
                : t('entryForm.oneTimeCode.secretPlaceholderNew')
            }
            onChange={(e) => {
              setFromUri(null)
              updateDraft({ secret: e.target.value })
            }}
            aria-invalid={invalidField === 'secret' || undefined}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setReveal(!reveal)}
            aria-label={
              reveal ? t('entryForm.oneTimeCode.hideSecret') : t('entryForm.oneTimeCode.showSecret')
            }
            aria-pressed={reveal}
          >
            {reveal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="totp-algorithm">
            {t('entryForm.oneTimeCode.algorithm')}
          </Label>
          <select
            id="totp-algorithm"
            value={draft.algorithm}
            onChange={(e) => {
              if (isTotpAlgorithm(e.target.value)) updateDraft({ algorithm: e.target.value })
            }}
            disabled={!!fromUri}
            aria-invalid={invalidField === 'algorithm' || undefined}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          >
            {TOTP_ALGORITHMS.map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {algorithm}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="totp-digits">
            {t('entryForm.oneTimeCode.digits')}
          </Label>
          <Input
            id="totp-digits"
            value={draft.digits}
            inputMode="numeric"
            maxLength={1}
            onChange={(e) => updateDraft({ digits: e.target.value.replace(/\D/g, '') })}
            disabled={!!fromUri}
            aria-invalid={invalidField === 'digits' || undefined}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor="totp-period">
            {t('entryForm.oneTimeCode.period')}
          </Label>
          <Input
            id="totp-period"
            value={draft.period}
            inputMode="numeric"
            maxLength={3}
            onChange={(e) => updateDraft({ period: e.target.value.replace(/\D/g, '') })}
            disabled={!!fromUri}
            aria-invalid={invalidField === 'period' || undefined}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
        </div>
      </div>

      <Button type="button" variant="ghost" size="xs" onClick={discardEdit}>
        {t('entryForm.oneTimeCode.discard')}
      </Button>
    </div>
  )
}
