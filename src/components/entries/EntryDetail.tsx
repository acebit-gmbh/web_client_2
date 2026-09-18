import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Star, Pencil, FolderInput, Trash2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { EntryIcon } from './EntryIcon'
import { EntryTypeRouter } from './EntryTypeRouter'
import { OneTimeCodeField } from './OneTimeCodeField'
import { SecondPasswordPrompt } from '@/components/common/SecondPasswordPrompt'
import { useEntry } from '@/hooks/useEntry'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import { getEntry } from '@/api/entries'
import { describeApiError, ERRCODE_INVALID_SECOND_PASS } from '@/lib/apiErrors'
import type { ApiError } from '@/api/client'
import type { EntryCompact } from '@/api/types'

interface EntryDetailProps {
  dbId: string
  compactEntry?: EntryCompact
  onEdit?: () => void
  onMove?: () => void
  onDelete?: () => void
}

/**
 * Formats a date-only value (the server stores `expires_at` as UTC midnight)
 * without applying the local timezone offset — otherwise a user in UTC-5 sees
 * the previous calendar day.
 */
function formatDateOnlyUtc(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

/** True once the expiry calendar day has fully passed (compared in UTC). */
function isExpired(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const expiryUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return expiryUtc < todayUtc
}

export function EntryDetail({ dbId, compactEntry, onEdit, onMove, onDelete }: EntryDetailProps) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const entryId = compactEntry?.id ?? null
  const selectEntry = useNavigationStore((s) => s.selectEntry)

  // The second-password store is the single source of truth — keeping a local
  // copy in this component is what allowed a stale password from a previously
  // viewed entry to be sent on a different entry's request.
  const secondPassword = useSecondPasswordStore((s) => s.getSecondPassword(entryId ?? ''))
  const setSecondPassword = useSecondPasswordStore((s) => s.setSecondPassword)
  const clearSecondPassword = useSecondPasswordStore((s) => s.clearSecondPassword)

  const needsSecondPassword = !!compactEntry?.has_second_pass && !secondPassword
  const { data: entry, isLoading, error, refetch } = useEntry(
    dbId,
    needsSecondPassword ? null : entryId,
    secondPassword,
  )

  // The prompt is open exactly when the entry needs unlocking — derived from
  // store state, no local mirror to drift (cancelling deselects the entry,
  // which unmounts this component).
  const showSecondPasswordPrompt = needsSecondPassword

  // Defensive: if a cached password is rejected later in the session (the
  // server-side second-password cache can expire independently), clear it and
  // drop the errored cache entry — clearing the stored password flips
  // needsSecondPassword back on, which re-opens the prompt automatically.
  // Only 4031 means "wrong second password" (19.x and 20.x alike); a plain
  // 403 (no permission, sealed) must not throw the password away and re-ask.
  const apiError = error as ApiError | null
  const isWrongPassword =
    apiError?.status === 403 && apiError.code === ERRCODE_INVALID_SECOND_PASS && !!secondPassword
  useEffect(() => {
    if (isWrongPassword && entryId) {
      clearSecondPassword(entryId)
      queryClient.removeQueries({ queryKey: ['entry', dbId, entryId] })
    }
  }, [isWrongPassword, entryId, dbId, clearSecondPassword, queryClient])

  // Verify the candidate password against the server before caching it. The
  // thrown ApiError on a wrong password surfaces inside the prompt (which owns
  // the inline error + field-clear); caching the password flips
  // needsSecondPassword off, which closes the prompt.
  async function handleSecondPasswordSubmit(password: string) {
    if (!entryId) return
    await getEntry(dbId, entryId, password)
    setSecondPassword(entryId, password)
  }

  if (!compactEntry) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        {t('entry.selectEntry')}
      </div>
    )
  }

  const tags = (entry?.tags ?? compactEntry.tags ?? '').split(',').filter(Boolean)
  const typeName = t(`entryType.${compactEntry.type}`, compactEntry.type.replace('_', ' '))
  const category = entry?.category ?? compactEntry.category
  const hasMetadata =
    tags.length > 0 || entry?.expires_at || entry?.comments || entry?.importance || category
  // Check if the type-specific section has any visible fields
  const hasTypeFields = !!(entry?.login || entry?.pass || entry?.url ||
    entry?.credit_card || entry?.license || entry?.identity ||
    entry?.information?.text || entry?.banking || entry?.rdp ||
    entry?.putty || entry?.teamviewer || entry?.document ||
    entry?.passkey || entry?.has_otp ||
    (entry?.custom_fields && entry.custom_fields.length > 0))

  return (
    <div className="lg:flex lg:h-full lg:flex-col">
      <div className="p-4 lg:flex-1">
        {/* Header — large icon + name + type */}
        <div className="mb-4 flex items-start gap-3">
          <EntryIcon
            type={compactEntry.type}
            icon={compactEntry.icon}
            databaseIcon={compactEntry.database_icon}
            dbId={dbId}
            className="h-10 w-10"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight">{compactEntry.name}</h2>
            <p className="text-sm text-muted-foreground">{typeName}</p>
          </div>
        </div>

        <Separator className="mb-4" />

        {/* Content */}
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : error && !needsSecondPassword ? (
          <div className="space-y-3">
            <div className="text-sm text-destructive">{describeApiError(error, t)}</div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
              <RotateCw className="h-3.5 w-3.5" />
              {t('common.retry')}
            </Button>
          </div>
        ) : entry ? (
          <div className="space-y-4">
            {/* Type-specific fields */}
            <EntryTypeRouter entry={entry} />

            {/* One-time code (Server 20.0.0+) - fetched only when the user asks for it */}
            {entry.has_otp === true && (
              <OneTimeCodeField
                dbId={dbId}
                entryId={entry.id}
                entryName={compactEntry.name}
                entryType={typeName}
              />
            )}

            {/* Metadata section — separator only if type fields were shown */}
            {hasMetadata && (
              <>
                {hasTypeFields && <Separator />}

                {/* Importance — always show */}
                {entry.importance && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t('entry.importance')}
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      {entry.importance === 'high' && <Star className="h-4 w-4 text-red-500" />}
                      <span className={entry.importance === 'high' ? 'text-red-500' : ''}>
                        {entry.importance.charAt(0).toUpperCase() + entry.importance.slice(1)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Category */}
                {category && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t('entry.category')}
                    </div>
                    <div className="text-sm">{category}</div>
                  </div>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t('entry.tags')}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag.trim()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expires */}
                {entry.expires_at && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t('entry.expires')}
                    </div>
                    <div className={`text-sm ${isExpired(entry.expires_at) ? 'text-red-500' : ''}`}>
                      {formatDateOnlyUtc(entry.expires_at, i18n.language)}
                      {isExpired(entry.expires_at) && ` (${t('entry.expired')})`}
                    </div>
                  </div>
                )}

                {/* Comments */}
                {entry.comments && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {t('entry.comments')}
                    </div>
                    <div className="whitespace-pre-wrap text-sm">{entry.comments}</div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}
      </div>

      {/* Action buttons — pinned to bottom on desktop, inline on mobile */}
      {entry && (onEdit || onMove || onDelete) && (
        <div className="px-4 pb-4 lg:shrink-0 lg:border-t lg:p-4">
          <div className="flex gap-2">
            {onEdit && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
                {t('common.edit')}
              </Button>
            )}
            {onMove && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={onMove}>
                <FolderInput className="h-3.5 w-3.5" />
                {t('common.move')}
              </Button>
            )}
            {onDelete && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Second password prompt */}
      {compactEntry && (
        <SecondPasswordPrompt
          open={showSecondPasswordPrompt}
          onClose={() => selectEntry(null)}
          entryName={compactEntry.name}
          entryType={typeName}
          onSubmit={handleSecondPasswordSubmit}
        />
      )}
    </div>
  )
}
