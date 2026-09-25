import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { downloadDocument } from '@/api/entries'
import { ApiError } from '@/api/client'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import { FileMetadata } from './FileMetadata'
import { useNavigationStore } from '@/stores/navigationStore'
import { useToast } from '@/hooks/useToast'
import { describeApiError, ERRCODE_INVALID_SECOND_PASS } from '@/lib/apiErrors'
import type { EntryDetail } from '@/api/types'

export function DocumentDetail({ entry }: { entry: EntryDetail }) {
  const { t } = useTranslation()
  const dbId = useNavigationStore((s) => s.currentDatabaseId)
  const toast = useToast()
  const [downloading, setDownloading] = useState(false)
  const [showWarning, setShowWarning] = useState(false)
  const secondPassword = useSecondPasswordStore((s) => s.getSecondPassword(entry.id))
  const clearSecondPassword = useSecondPasswordStore((s) => s.clearSecondPassword)
  const doc = entry.document
  if (!doc) return null

  async function performDownload() {
    if (!dbId || downloading) return
    setDownloading(true)
    setShowWarning(false)
    try {
      const { blob, filename: serverFilename } = await downloadDocument(
        dbId,
        entry.id,
        secondPassword,
      )
      // Prefer the document's original name, fall back to server Content-Disposition
      const filename = doc?.name || serverFilename || entry.name || 'document'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        err.code === ERRCODE_INVALID_SECOND_PASS
      ) {
        // EntryDetail will ask for a fresh second password when the cached one expires.
        clearSecondPassword(entry.id)
      }
      toast.error(describeApiError(err, t), {
        title: t('toast.downloadFailed'),
      })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <FileMetadata file={doc} />
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => setShowWarning(true)}
        disabled={downloading}
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="h-4 w-4" />
        )}
        {t('entry.download')}
      </Button>

      {/* Security warning before download */}
      <ConfirmDialog
        open={showWarning}
        onClose={() => setShowWarning(false)}
        onConfirm={performDownload}
        title={t('document.downloadWarningTitle')}
        description={t('document.downloadWarningDesc')}
        icon={<ShieldAlert className="h-5 w-5 text-amber-500" />}
        confirmLabel={t('document.downloadConfirm')}
      />
    </div>
  )
}
