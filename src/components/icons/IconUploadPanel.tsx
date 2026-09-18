import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatBytes } from '@/lib/format'
import {
  ICON_SOURCE_ACCEPT,
  ICON_SOURCE_MAX_BYTES,
  IconPrepareError,
  normalizeIconMaxBytes,
  prepareIconUpload,
  suggestIconName,
  validateIconName,
  type IconNameProblem,
  type PreparedIcon,
} from '@/lib/iconUpload'

/** An image that is prepared and named but not uploaded yet. */
export interface IconUploadDraft {
  prepared: PreparedIcon
  name: string
}

const NAME_PROBLEM_KEYS: Record<IconNameProblem, string> = {
  empty: 'entryForm.icon.errors.nameEmpty',
  tooLong: 'entryForm.icon.errors.nameTooLong',
  tooManyBytes: 'entryForm.icon.errors.nameTooManyBytes',
  forbidden: 'entryForm.icon.errors.nameForbidden',
}

interface IconUploadPanelProps {
  /** `icons.max_bytes` of the database. */
  maxBytes: unknown
  /** The URL typed into the entry form; its host is the suggested icon name. */
  entryUrl?: string | null
  draft: IconUploadDraft | null
  onDraftChange: (draft: IconUploadDraft | null) => void
  /** Sends the draft. Called only with a name that passes the server's rules. */
  onUpload: () => void
  isUploading: boolean
  /** Why the last upload failed, already localized. */
  uploadError: string | null
  disabled?: boolean
}

/**
 * The "Upload" tab of the icon picker: pick a file, see the 64 x 64 result,
 * name it, send it. The file never leaves the browser as it is - it is
 * decoded and re-encoded locally (prepareIconUpload) - and the preview is a
 * `data:` URL, never an object URL (the CSP has no `blob:`). This is not a
 * form of its own: Enter in the name field uploads instead of saving the
 * entry around it.
 */
export function IconUploadPanel({
  maxBytes,
  entryUrl,
  draft,
  onDraftChange,
  onUpload,
  isUploading,
  uploadError,
  disabled = false,
}: IconUploadPanelProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameId = useId()
  const [preparing, setPreparing] = useState(false)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [nameProblem, setNameProblem] = useState<IconNameProblem | null>(null)

  const busy = disabled || preparing || isUploading

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input so choosing the same file again fires a change event.
    e.target.value = ''
    if (!file) return

    setPrepareError(null)
    setNameProblem(null)
    setPreparing(true)
    try {
      const prepared = await prepareIconUpload(file, maxBytes)
      onDraftChange({ prepared, name: suggestIconName(entryUrl, file.name) })
    } catch (err) {
      const problem = err instanceof IconPrepareError ? err.problem : 'decode'
      const max =
        problem === 'fileTooLarge' ? ICON_SOURCE_MAX_BYTES : normalizeIconMaxBytes(maxBytes)
      setPrepareError(t(`entryForm.icon.errors.${problem}`, { max: formatBytes(max) }))
    } finally {
      setPreparing(false)
    }
  }

  function handleUpload() {
    if (!draft || busy) return
    const problem = validateIconName(draft.name)
    setNameProblem(problem)
    if (!problem) onUpload()
  }

  const error = prepareError ?? (nameProblem ? t(NAME_PROBLEM_KEYS[nameProblem]) : uploadError)

  return (
    <div className="space-y-3">
      {/* Raster types only - SVG is never accepted, not even as a source. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ICON_SOURCE_ACCEPT}
        className="hidden"
        data-testid="icon-file-input"
        onChange={handleFile}
      />

      {draft && (
        <div className="flex items-start gap-3">
          <img
            src={draft.prepared.previewUrl}
            alt={t('entryForm.icon.preview')}
            width={64}
            height={64}
            className="bg-muted h-16 w-16 shrink-0 rounded-md border object-contain"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs" htmlFor={nameId}>
              {t('entryForm.icon.name')}
            </Label>
            <Input
              id={nameId}
              value={draft.name}
              onChange={(e) => {
                setNameProblem(null)
                onDraftChange({ ...draft, name: e.target.value })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleUpload()
                }
              }}
              disabled={busy}
              aria-invalid={nameProblem !== null || undefined}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
            <p className="text-muted-foreground text-xs">{t('entryForm.icon.nameHint')}</p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {draft && (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={handleUpload}
            disabled={busy}
          >
            {isUploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isUploading ? t('entryForm.icon.uploading') : t('entryForm.icon.upload')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          {preparing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImagePlus className="h-3.5 w-3.5" />
          )}
          {draft ? t('entryForm.icon.chooseAnother') : t('entryForm.icon.chooseFile')}
        </Button>
        {draft && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setNameProblem(null)
              setPrepareError(null)
              onDraftChange(null)
            }}
            disabled={busy}
          >
            {t('entryForm.icon.discard')}
          </Button>
        )}
      </div>

      <p className="text-muted-foreground text-xs">{t('entryForm.icon.uploadHint')}</p>
    </div>
  )
}
