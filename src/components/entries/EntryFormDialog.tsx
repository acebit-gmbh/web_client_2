import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Wand2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { PasswordGenerator } from '@/components/common/PasswordGenerator'
import { TotpSection } from './TotpSection'
import { useTotpCapability } from '@/hooks/useTotpCapability'
import { ApiError } from '@/api/client'
import { describeTotpWriteError, totpRefusedField } from '@/lib/apiErrors'
import {
  buildTotpWrite,
  isTotpWritableType,
  TOTP_UNTOUCHED,
  validateTotpDraft,
  type StoredTotpParams,
  type TotpEdit,
  type TotpField,
} from '@/lib/totp'
import type { EntryDetail, EntryType, CreateEntryRequest, TotpWrite } from '@/api/types'

const MM_YYYY_RE = /^(0[1-9]|1[0-2])\/\d{4}$/

/**
 * The `totp.state` values the editor knows how to present. The API asks
 * that a state a later server adds be treated like `hidden` - no code, no
 * editor - so the gate names these instead of excluding `hidden` alone.
 */
const EDITABLE_TOTP_STATES: readonly string[] = ['none', 'set', 'invalid']

/** Auto-insert the slash and keep only digits so the input stays in MM/YYYY shape. */
function formatMmYyyy(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

interface EntryFormDialogProps {
  open: boolean
  onClose: () => void
  /** Existing entry for editing, null for creating */
  entry?: EntryDetail | null
  /** Pre-selected type for new entries */
  defaultType?: EntryType
  /**
   * Database the entry lives in. Only the create form needs it, to learn
   * from the database's cached listings whether the server accepts
   * one-time-code settings (see useTotpCapability).
   */
  dbId?: string | null
  /** Called with the form data */
  onSubmit: (data: CreateEntryRequest) => Promise<void>
  isSubmitting: boolean
}

export function EntryFormDialog({
  open,
  onClose,
  entry,
  defaultType = 'password',
  dbId,
  onSubmit,
  isSubmitting,
}: EntryFormDialogProps) {
  const { t } = useTranslation()
  const isEditing = !!entry
  // Linked entries derive login/pass from a source entry; the server ignores
  // any incoming changes to those fields, so the form must mirror that and
  // present them as read-only to avoid misleading the user.
  const isLinked = !!entry?.is_link
  const [error, setError] = useState<string | null>(null)
  const [showPasswordGen, setShowPasswordGen] = useState(false)

  // Form state — initialize from entry if editing. The dialog is
  // conditionally mounted by its parents, so every open is a fresh component
  // instance and these initializers run again with the right values.
  const type: EntryType = entry?.type ?? defaultType
  const [name, setName] = useState(entry?.name ?? '')
  const [login, setLogin] = useState(entry?.login ?? '')
  const [pass, setPass] = useState(entry?.pass ?? '')
  const [url, setUrl] = useState(entry?.url ?? '')
  const [comments, setComments] = useState(entry?.comments ?? '')
  const [tags, setTags] = useState(entry?.tags ?? '')
  const [importance, setImportance] = useState(entry?.importance ?? 'normal')
  const [expiresAt, setExpiresAt] = useState(entry?.expires_at?.split('T')[0] ?? '')

  // Type-specific fields
  const [creditCard, setCreditCard] = useState(entry?.credit_card ?? {})
  const [license, setLicense] = useState(entry?.license ?? {})
  const [identity, setIdentity] = useState(entry?.identity ?? {})
  const [information, setInformation] = useState(entry?.information ?? {})
  const [banking, setBanking] = useState(entry?.banking ?? {})
  const [rdp, setRdp] = useState(entry?.rdp ?? {})
  const [putty, setPutty] = useState(entry?.putty ?? {})
  const [teamviewer, setTeamviewer] = useState(entry?.teamviewer ?? {})

  // One-time code (Server 20.0.0+). The editor is invisible unless the server
  // has shown that it accepts the `totp` key: on edit the loaded entry carries
  // `totp` (and says whether this entry's type is writable; `hidden` means we
  // may not read it, and a write would be refused with 4033; an unknown state
  // counts as `hidden`), on create a compact row of the database has. Older
  // servers ignore unknown keys, so there is no way to find out by trying.
  const serverWritesTotp = useTotpCapability(isEditing ? null : (dbId ?? null))
  const showTotp = isEditing
    ? !!entry.totp &&
      entry.totp.writable !== false &&
      EDITABLE_TOTP_STATES.includes(entry.totp.state)
    : serverWritesTotp === true && isTotpWritableType(type)
  const storedTotp: StoredTotpParams | null =
    entry?.totp && (entry.totp.state === 'set' || entry.totp.state === 'invalid')
      ? {
          algorithm: entry.totp.algorithm ?? null,
          digits: entry.totp.digits ?? NaN,
          period: entry.totp.period ?? NaN,
        }
      : null
  const [totp, setTotp] = useState<TotpEdit>(TOTP_UNTOUCHED)
  const [totpInvalid, setTotpInvalid] = useState<TotpField | null>(null)

  function handleTotpChange(next: TotpEdit) {
    setTotp(next)
    setTotpInvalid(null)
  }

  // The secret must not outlive the dialog: drop the editing state on every
  // way out (the parents also unmount the dialog, this makes it explicit).
  function handleClose() {
    setTotp(TOTP_UNTOUCHED)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)

    if (type === 'credit_card' && creditCard.valid_thru) {
      if (!MM_YYYY_RE.test(creditCard.valid_thru)) {
        setError(t('entryForm.invalidValidThru'))
        return
      }
    }

    // `totp` is built explicitly, never through clearable(): untouched omits
    // the key, remove sends the literal null, a new secret sends all four
    // members, a parameter change without a secret sends the parameters
    // only. An empty string would be a shape error (4005), not a clear. The
    // server's admission rules are applied here first so a typo is caught
    // without a round trip; the server judges again.
    let totpWrite: TotpWrite | null | undefined
    if (showTotp) {
      totpWrite = buildTotpWrite(totp, storedTotp)
      if (totpWrite) {
        const failing = validateTotpDraft(totpWrite)
        if (failing) {
          setTotpInvalid(failing)
          setError(t(`entryForm.oneTimeCode.errors.${failing}`))
          return
        }
      }
    }

    // On edit, an emptied text field must be sent as an empty string so the
    // server actually clears it. (JSON.stringify drops `undefined`, and the
    // server only updates fields present in the payload, so `undefined` would
    // silently keep the old value.) On create, omitting empties is fine.
    const clearable = (value: string): string | undefined =>
      isEditing ? value : value || undefined

    const base: CreateEntryRequest = {
      name: name.trim(),
      importance,
      tags: clearable(tags),
      comments: clearable(comments),
    }
    // `type` only belongs in a create payload; UpdateEntryRequest has no
    // `type`, so omit it when editing.
    if (!isEditing) {
      base.type = type
    }
    // Credit Card: expiry is derived from valid_thru on the server; omitting
    // expires_at here avoids overwriting the server-computed value.
    if (type !== 'credit_card') {
      base.expires_at = expiresAt ? new Date(expiresAt).toISOString() : null
    }

    // Add type-specific fields
    if (type === 'password' || type === 'custom') {
      // Linked entries derive login/pass from a source entry — the server
      // ignores them on PATCH, so we omit them from the payload entirely.
      Object.assign(base, {
        login: isLinked ? undefined : clearable(login),
        pass: isLinked ? undefined : clearable(pass),
        url: clearable(url),
      })
    } else {
      if (type === 'credit_card') Object.assign(base, { credit_card: creditCard })
      if (type === 'license') Object.assign(base, { license })
      if (type === 'identity') Object.assign(base, { identity })
      if (type === 'information') Object.assign(base, { information })
      if (type === 'banking') Object.assign(base, { banking })
      if (type === 'rdp') Object.assign(base, { rdp })
      if (type === 'putty') {
        // The API expects `port` as an integer. The form state holds it as a
        // string while the user is typing (so the input stays editable);
        // coerce here, dropping the field entirely if it's empty or not a
        // sensible TCP port number.
        const puttyPayload: typeof putty = { ...putty }
        const rawPort = (puttyPayload as { port?: string | number }).port
        if (rawPort === undefined || rawPort === null || rawPort === '') {
          delete (puttyPayload as { port?: unknown }).port
        } else {
          const parsed = typeof rawPort === 'number' ? rawPort : Number(rawPort)
          if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
            ;(puttyPayload as { port?: number }).port = parsed
          } else {
            delete (puttyPayload as { port?: unknown }).port
          }
        }
        Object.assign(base, { putty: puttyPayload })
      }
      if (type === 'teamviewer') Object.assign(base, { teamviewer })
    }

    if (totpWrite !== undefined) {
      base.totp = totpWrite
    }

    try {
      await onSubmit(base)
      handleClose()
    } catch (err) {
      // The save failure is surfaced by the mutation's onError toast; showing
      // an inline alert here too would duplicate the same message. Swallow the
      // rejection so the dialog stays open (without closing) for a retry.
      // The exception is a refused one-time-code write (4001-4006, 4033): the
      // toast skips those, and this form names the member in the browser's
      // language - status first, then code, never the server's text. A 4001
      // to a parameter-only change means the stored seed produces no code;
      // the secret input is still the one to highlight, since a new secret
      // is the repair.
      if (err instanceof ApiError) {
        const secretSent = !!totpWrite && 'secret' in totpWrite
        const message = describeTotpWriteError(err.status, err.code, t, secretSent)
        if (message) {
          setTotpInvalid(totpRefusedField(err.status, err.code))
          setError(message)
        }
      }
    }
  }


  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('entryForm.editTitle') : t('entryForm.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Name — always shown */}
          <div className="space-y-2">
            <Label>{t('entryForm.name')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
            />
          </div>

          <Separator />

          {/* Type-specific fields */}
          {(type === 'password' || type === 'custom') && (
            <div className="space-y-4">
              {isLinked && (
                <Alert>
                  <AlertDescription>{t('entryForm.linkedNotice')}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>{t('entry.login')}</Label>
                <Input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  disabled={isLinked}
                  readOnly={isLinked}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t('entry.password')}</Label>
                  {!isLinked && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowPasswordGen(!showPasswordGen)}
                    >
                      <Wand2 className="mr-1 h-3 w-3" />
                      {t('entryForm.generate')}
                    </Button>
                  )}
                </div>
                <Input
                  type="password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  disabled={isLinked}
                  readOnly={isLinked}
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                />
                {showPasswordGen && !isLinked && (
                  <div className="rounded-md border p-3">
                    <PasswordGenerator
                      onUse={(pw) => {
                        setPass(pw)
                        setShowPasswordGen(false)
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('entry.url')}</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
              </div>
            </div>
          )}

          {type === 'credit_card' && (
            <TypeFields fields={creditCard} onChange={setCreditCard} fieldDefs={[
              { key: 'holder', label: t('entry.cardHolder') },
              { key: 'number', label: t('entry.cardNumber') },
              { key: 'valid_thru', label: t('entry.validThru'), kind: 'mm-yyyy' },
              { key: 'cvv', label: t('entry.cvv'), type: 'password' },
              { key: 'pin', label: t('entry.pin'), type: 'password' },
            ]} />
          )}

          {type === 'license' && (
            <TypeFields fields={license} onChange={setLicense} fieldDefs={[
              { key: 'product', label: t('entry.product') },
              { key: 'version', label: t('entry.version') },
              { key: 'reg_name', label: t('entry.regName') },
              { key: 'key_1', label: t('entry.licenseKey') },
              { key: 'key_2', label: t('entry.licenseKey2') },
              { key: 'user', label: t('entry.login') },
              { key: 'pass', label: t('entry.password'), type: 'password' },
            ]} />
          )}

          {type === 'identity' && (
            <TypeFields fields={identity} onChange={setIdentity} fieldDefs={[
              { key: 'first_name', label: t('entry.firstName') },
              { key: 'last_name', label: t('entry.lastName') },
              { key: 'email', label: t('entry.email') },
              { key: 'company', label: t('entry.company') },
              { key: 'phone', label: t('entry.phone') },
              { key: 'address_1', label: t('entry.address') },
              { key: 'city', label: t('entry.city') },
              { key: 'country', label: t('entry.country') },
            ]} />
          )}

          {type === 'information' && (
            <div className="space-y-2">
              <Label>{t('entry.text')}</Label>
              <textarea
                value={information.text ?? ''}
                onChange={(e) => setInformation({ text: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={6}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
              />
            </div>
          )}

          {type === 'banking' && (
            <TypeFields fields={banking} onChange={setBanking} fieldDefs={[
              { key: 'bank_name', label: t('entry.bankName') },
              { key: 'iban', label: t('entry.iban') },
              { key: 'bic', label: t('entry.bic') },
              { key: 'holder', label: t('entry.accountHolder') },
              { key: 'user', label: t('entry.login') },
              { key: 'pass', label: t('entry.password'), type: 'password' },
              { key: 'pin', label: t('entry.pin'), type: 'password' },
            ]} />
          )}

          {type === 'rdp' && (
            <TypeFields fields={rdp} onChange={setRdp} fieldDefs={[
              { key: 'host', label: t('entry.host') },
              { key: 'user', label: t('entry.login') },
              { key: 'pass', label: t('entry.password'), type: 'password' },
              { key: 'cmd_line', label: t('entry.cmdLine') },
            ]} />
          )}

          {type === 'putty' && (
            <TypeFields fields={putty} onChange={setPutty} fieldDefs={[
              { key: 'host', label: t('entry.host') },
              { key: 'port', label: t('entry.port'), kind: 'integer' },
              { key: 'user', label: t('entry.login') },
              { key: 'pass', label: t('entry.password'), type: 'password' },
            ]} />
          )}

          {type === 'teamviewer' && (
            <TypeFields fields={teamviewer} onChange={setTeamviewer} fieldDefs={[
              { key: 'partner_id', label: t('entry.partnerId') },
              { key: 'pass', label: t('entry.password'), type: 'password' },
            ]} />
          )}

          {/* One-time code (Server 20.0.0+) — only when the server has shown it accepts it */}
          {showTotp && (
            <>
              <Separator />
              <TotpSection
                stored={entry?.totp}
                value={totp}
                onChange={handleTotpChange}
                invalidField={totpInvalid}
              />
            </>
          )}

          <Separator />

          {/* Common fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('entry.tags')}</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t('entryForm.tagsPlaceholder')}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('entry.comments')}</Label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                rows={3}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('entry.importance')}</Label>
                <select
                  value={importance}
                  onChange={(e) => setImportance(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="low">{t('entryForm.importanceLow')}</option>
                  <option value="normal">{t('entryForm.importanceNormal')}</option>
                  <option value="high">{t('entryForm.importanceHigh')}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>{t('entry.expires')}</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  disabled={type === 'credit_card'}
                  title={type === 'credit_card' ? t('entryForm.expiresFromValidThru') : undefined}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
                {type === 'credit_card' && (
                  <p className="text-xs text-muted-foreground">
                    {t('entryForm.expiresFromValidThru')}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" className="flex-1" disabled={!name.trim() || isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {isEditing ? t('common.save') : t('entryForm.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Generic type-specific field renderer */
function TypeFields({
  fields,
  onChange,
  fieldDefs,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (fields: any) => void
  fieldDefs: Array<{ key: string; label: string; type?: string; kind?: 'mm-yyyy' | 'integer' }>
}) {
  return (
    <div className="space-y-3">
      {fieldDefs.map((def) => {
        // Values may arrive as numbers (e.g. PuttyFields.port from the
        // server) — coerce to string for the input.
        const raw = fields[def.key] != null ? String(fields[def.key]) : ''
        const isMmYyyy = def.kind === 'mm-yyyy'
        const isInteger = def.kind === 'integer'
        const isPassword = def.type === 'password'
        const invalidMmYyyy = isMmYyyy && raw !== '' && !MM_YYYY_RE.test(raw)
        return (
          <div key={def.key} className="space-y-1">
            <Label className="text-xs">{def.label}</Label>
            <Input
              type={def.type ?? 'text'}
              value={raw}
              placeholder={isMmYyyy ? 'MM/YYYY' : undefined}
              inputMode={isMmYyyy || isInteger ? 'numeric' : undefined}
              maxLength={isMmYyyy ? 7 : isInteger ? 5 : undefined}
              aria-invalid={invalidMmYyyy || undefined}
              // Suppress browser/password-manager autofill so saved
              // web-client credentials don't bleed into vault entry fields, and
              // so secrets aren't offered for saving into the browser store.
              autoComplete={isPassword ? 'new-password' : 'off'}
              data-1p-ignore
              data-lpignore="true"
              onChange={(e) => {
                let next: string
                if (isMmYyyy) next = formatMmYyyy(e.target.value)
                else if (isInteger) next = e.target.value.replace(/\D/g, '')
                else next = e.target.value
                onChange({ ...fields, [def.key]: next })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
