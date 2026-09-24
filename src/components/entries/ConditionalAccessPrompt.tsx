import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { verifyLabel, warningLevel, warningMessageText } from '@/lib/conditionalAccess'
import type { EntryWarning } from '@/api/types'

interface ConditionalAccessPromptProps {
  warning: EntryWarning
  entryName: string
  entryType: string
  /** The user chose to go on: only now may the entry be read or used. */
  onConfirm: () => void
  /** Cancel, Esc, the backdrop and the close button all end up here. */
  onCancel: () => void
}

/**
 * Asks about a `confirm` or `verify` warning (Server 20.0.0+) before an entry
 * is used, the way the Windows client does. For `verify` - and for any level
 * the client does not know - the Continue button stays disabled until the
 * checkbox is ticked. The message is the entry owner's plain text and is
 * rendered as text.
 *
 * Mount it only while a warning waits for an answer, keyed by the warning's
 * identity, so that a new warning never inherits a ticked box.
 */
export function ConditionalAccessPrompt({
  warning,
  entryName,
  entryType,
  onConfirm,
  onCancel,
}: ConditionalAccessPromptProps) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const [agreed, setAgreed] = useState(false)
  const mustTick = warningLevel(warning) === 'verify'

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center">{t('entry.conditionalAccess.title')}</DialogTitle>
          <p className="text-muted-foreground text-center text-sm">
            <span className="text-foreground font-medium">{entryName}</span>
            <br />
            {entryType}
          </p>
        </DialogHeader>

        {/* focusable, so a long message can be scrolled from the keyboard in every browser */}
        <DialogDescription
          tabIndex={0}
          className="bg-muted/40 text-foreground focus-visible:ring-ring max-h-60 overflow-y-auto rounded-md border px-3 py-2 break-words whitespace-pre-wrap outline-none focus-visible:ring-2"
        >
          {warningMessageText(warning)}
        </DialogDescription>

        {mustTick && (
          <div className="flex items-start gap-2">
            <Checkbox
              id={checkboxId}
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor={checkboxId} className="leading-snug font-normal">
              {verifyLabel(warning) ?? t('entry.conditionalAccess.agree')}
            </Label>
          </div>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={mustTick && !agreed}
            onClick={onConfirm}
          >
            {t('entry.conditionalAccess.continue')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
