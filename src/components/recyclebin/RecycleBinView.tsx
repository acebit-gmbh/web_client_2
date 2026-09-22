import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Undo2, AlertTriangle, AlertCircle, RotateCw } from 'lucide-react'
import { EntryIcon } from '@/components/entries/EntryIcon'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRecycleBin } from '@/hooks/useRecycleBin'
import { useRecycleBinCapability } from '@/hooks/useRecycleBinCapability'
import {
  useEmptyRecycleBin,
  usePurgeFromRecycleBin,
  useRestoreFromRecycleBin,
} from '@/hooks/mutations/useRecycleBinMutations'
import { useProfile } from '@/hooks/useProfile'
import { useUserName } from '@/hooks/useUserName'
import type { RecycleBinItem } from '@/api/recyclebin'
import { isFolder } from '@/api/types'

interface RecycleBinViewProps {
  dbId: string
}

/**
 * The database's recycle bin: what this caller may see of it, with restore and
 * delete-for-good per row and one action to empty it.
 *
 * Three things this view is careful about, because the server does them and a
 * confident UI would misreport all three:
 *
 *   - Restore and delete-for-good need DIFFERENT rights, and neither follows
 *     from having deleted the item, so either can be refused on its own. Both
 *     are offered on every row and the refusal is reported when it comes,
 *     rather than guessed at beforehand.
 *   - Emptying the bin leaves behind whatever the caller may not delete, and
 *     still answers 204. The list is re-read afterwards and says what is left;
 *     nothing here claims the bin is now empty.
 *   - There is no deletion timestamp. Rows carry only `deleted_by`, so they
 *     cannot be ordered or labelled by time - they arrive in the server's
 *     order and stay in it.
 */
export function RecycleBinView({ dbId }: RecycleBinViewProps) {
  const { t } = useTranslation()
  const capability = useRecycleBinCapability(dbId)
  const { data, isLoading, isError, refetch } = useRecycleBin(dbId)
  const { data: profile } = useProfile()

  const restore = useRestoreFromRecycleBin(dbId)
  const purge = usePurgeFromRecycleBin(dbId)
  const empty = useEmptyRecycleBin(dbId)

  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState<RecycleBinItem | null>(null)

  const items = data?.data ?? []
  const total = data?.total ?? 0

  if (isError) {
    // The same block VaultPage renders for a failed listing; it is a local
    // helper there rather than a shared component, so it is repeated here the
    // way the empty states already are.
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="max-w-sm text-sm text-muted-foreground">{t('recycleBin.loadFailed')}</p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
          <RotateCw className="h-3.5 w-3.5" />
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Trash2 className="h-4 w-4" />
          <span className="font-medium text-foreground">{t('recycleBin.title')}</span>
          {!isLoading && <span>{t('recycleBin.itemCount', { count: total })}</span>}
        </div>
        {items.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setConfirmEmpty(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" />
            {t('recycleBin.empty')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Trash2 className="mb-2 h-10 w-10" />
          <p>{t('recycleBin.emptyState')}</p>
          <p className="mt-1 max-w-sm text-xs">{t('recycleBin.emptyStateHint')}</p>
        </div>
      ) : (
        <div className="divide-y rounded-md border" data-testid="recycle-bin-list">
          {items.map((item) => (
            <RecycleBinRow
              key={item.id}
              item={item}
              canManage={capability?.can_manage === true}
              isOwn={!!profile?.id && item.deleted_by === profile.id}
              onRestore={() => restore.mutate(item.id)}
              onPurge={() => setConfirmPurge(item)}
            />
          ))}
        </div>
      )}

      {data?.truncated && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {t('recycleBin.truncatedNotice', { count: items.length })}
        </p>
      )}

      <ConfirmDialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={() => empty.mutate()}
        title={t('confirm.emptyRecycleBinTitle')}
        description={t('confirm.emptyRecycleBinDesc')}
        confirmLabel={t('recycleBin.empty')}
        destructive
      />

      <ConfirmDialog
        open={confirmPurge !== null}
        onClose={() => setConfirmPurge(null)}
        onConfirm={() => confirmPurge && purge.mutate(confirmPurge.id)}
        title={t('confirm.purgeItemTitle')}
        description={t('confirm.purgeItemDesc', { name: confirmPurge?.name ?? '' })}
        destructive
      />
    </div>
  )
}

interface RecycleBinRowProps {
  item: RecycleBinItem
  canManage: boolean
  isOwn: boolean
  onRestore: () => void
  onPurge: () => void
}

/**
 * Not a button, unlike a listing row: there is nowhere to navigate to - a
 * recycled item answers 404 on the entry and folder routes until it is back -
 * and the row carries two real buttons of its own.
 */
function RecycleBinRow({ item, canManage, isOwn, onRestore, onPurge }: RecycleBinRowProps) {
  const { t } = useTranslation()
  const folder = isFolder(item)
  // `deleted_by` is the server's user GUID, which says nothing to a reader, so
  // it is resolved to a name and the attribution is dropped when it cannot be.
  const deletedByName = useUserName(canManage && !isOwn ? item.deleted_by : null)

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <EntryIcon type={item.type} icon={item.icon} databaseIcon={item.database_icon} />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{item.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {folder ? t('recycleBin.folderWithContents') : t(`entryType.${item.type}`)}
          {/* Only where other people's deletions can appear at all: on a bin of
              your own items every row would say the same thing. */}
          {canManage && item.deleted_by && isOwn && <> · {t('recycleBin.deletedByYou')}</>}
          {canManage && deletedByName && (
            <> · {t('recycleBin.deletedBy', { user: deletedByName })}</>
          )}
        </span>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={onRestore}
        title={t('recycleBin.restore')}
        aria-label={t('recycleBin.restoreItem', { name: item.name })}
      >
        <Undo2 className="h-4 w-4" />
        <span className="ml-1.5 hidden sm:inline">{t('recycleBin.restore')}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onPurge}
        title={t('recycleBin.purge')}
        aria-label={t('recycleBin.purgeItem', { name: item.name })}
      >
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <span className="ml-1.5 hidden sm:inline">{t('recycleBin.purge')}</span>
      </Button>
    </div>
  )
}
