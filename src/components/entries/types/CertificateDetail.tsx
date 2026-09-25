import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { UploadProgressDialog } from '@/components/common/UploadProgressDialog'
import { EntryDetailField } from '../EntryDetailField'
import { CertificateMetadata, FileMetadata } from './FileMetadata'
import { downloadDocument, uploadDocument, MAX_DOCUMENT_SIZE } from '@/api/entries'
import { ApiError } from '@/api/client'
import type { CertificatePart, EntryDetail } from '@/api/types'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import { useToast } from '@/hooks/useToast'
import { describeApiError, ERRCODE_INVALID_SECOND_PASS } from '@/lib/apiErrors'
import { formatBytes } from '@/lib/format'

export function CertificateDetail({ entry }: { entry: EntryDetail }) {
  const { t } = useTranslation()
  const dbId = useNavigationStore((s) => s.currentDatabaseId)
  const secondPassword = useSecondPasswordStore((s) => s.getSecondPassword(entry.id))
  const queryClient = useQueryClient()
  const toast = useToast()
  const [downloadPart, setDownloadPart] = useState<CertificatePart | null>(null)
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  useEffect(
    () => () => {
      sequence.current++
      controller.current?.abort()
    },
    [entry.id, dbId],
  )

  function reportError(err: unknown, title: string) {
    if (err instanceof ApiError && err.status === 403 && err.code === ERRCODE_INVALID_SECOND_PASS) {
      useSecondPasswordStore.getState().clearSecondPassword(entry.id)
    }
    toast.error(describeApiError(err, t), { title })
  }

  async function downloadFile(part: CertificatePart) {
    if (!dbId || busy) return
    const seq = ++sequence.current
    setBusy(true)
    setDownloadPart(null)
    try {
      const result = await downloadDocument(dbId, entry.id, secondPassword, part)
      if (seq !== sequence.current) return
      const file =
        part === 'public' ? entry.certificate?.public_key : entry.certificate?.private_key
      const url = URL.createObjectURL(result.blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = file?.name || result.filename || entry.name
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      if (seq === sequence.current) reportError(err, t('toast.downloadFailed'))
    } finally {
      if (seq === sequence.current) setBusy(false)
    }
  }

  async function uploadFile(part: CertificatePart, file: File | undefined) {
    if (!file || !dbId || busy) return
    if (file.size > MAX_DOCUMENT_SIZE) {
      toast.error(t('toast.fileTooLarge', { max: formatBytes(MAX_DOCUMENT_SIZE) }), {
        title: t('toast.fileTooLargeTitle'),
      })
      return
    }
    const seq = ++sequence.current
    const abortController = new AbortController()
    controller.current = abortController
    setBusy(true)
    setUpload({ name: file.name, progress: 0 })
    try {
      await uploadDocument(dbId, entry.id, file, {
        part,
        secondPassword,
        signal: abortController.signal,
        onProgress: (progress) => {
          if (seq === sequence.current) setUpload({ name: file.name, progress })
        },
      })
      if (seq === sequence.current) toast.success(t('toast.uploadSucceeded'))
    } catch (err) {
      if (seq === sequence.current && !(err instanceof DOMException && err.name === 'AbortError')) {
        reportError(err, t('toast.uploadFailed'))
      }
    } finally {
      // Even after unmount, cancellation may follow a completed server write.
      // Invalidate the captured entry/database; this does not recreate a cache cleared at logout.
      void queryClient.invalidateQueries({ queryKey: ['entry', dbId, entry.id] })
      void queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      void queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      if (seq === sequence.current) {
        controller.current = null
        setUpload(null)
        setBusy(false)
      }
    }
  }

  const certificate = entry.certificate
  if (!certificate) return null
  return (
    <div className="space-y-4">
      <EntryDetailField label={t('entry.password')} value={certificate.pass} sensitive copyable />
      <CertificateMetadata certificate={certificate} />
      {(['public', 'private'] as const).map((part) => {
        const file = part === 'public' ? certificate.public_key : certificate.private_key
        const label = t(part === 'public' ? 'fileEntry.publicKey' : 'fileEntry.privateKey')
        return (
          <fieldset key={part} className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{label}</legend>
            {file ? (
              <FileMetadata file={file} />
            ) : (
              <p className="text-muted-foreground text-sm">{t('fileEntry.noAttachment')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {file && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDownloadPart(part)}
                >
                  {t('fileEntry.downloadPart', { part: label })}
                </Button>
              )}
              {!entry.is_link && (
                <label className="text-sm">
                  <span className="mb-1 block">
                    {t(file ? 'fileEntry.replacePart' : 'fileEntry.uploadPart', { part: label })}
                  </span>
                  <input
                    type="file"
                    disabled={busy}
                    className="block max-w-full text-sm"
                    onChange={(event) => {
                      const selected = event.target.files?.[0]
                      event.target.value = ''
                      void uploadFile(part, selected)
                    }}
                  />
                </label>
              )}
            </div>
          </fieldset>
        )
      })}
      <ConfirmDialog
        open={downloadPart !== null}
        onClose={() => setDownloadPart(null)}
        onConfirm={() => downloadPart && downloadFile(downloadPart)}
        title={t('fileEntry.downloadWarningTitle')}
        description={t('fileEntry.downloadWarningDesc')}
        confirmLabel={t('document.downloadConfirm')}
      />
      {upload && (
        <UploadProgressDialog
          open
          fileName={upload.name}
          progress={upload.progress}
          onCancel={() => controller.current?.abort()}
        />
      )}
    </div>
  )
}
