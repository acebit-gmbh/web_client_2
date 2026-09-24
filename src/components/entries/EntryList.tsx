import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpDown, ArrowUp, ArrowDown, Lock, KeyRound, Folder as FolderIcon, ExternalLink } from 'lucide-react'
import { EntryIcon } from './EntryIcon'
import { ConditionalAccessPrompt } from './ConditionalAccessPrompt'
import { useSortedItems, type SortField, type SortConfig } from '@/hooks/useSortedItems'
import { useToast } from '@/hooks/useToast'
import { formatRelativeDate } from '@/lib/dates'
import { getSafeHref, openSafeUrl } from '@/lib/url'
import { isBlockingWarning, warningIdentity, warningMessageText } from '@/lib/conditionalAccess'
import { useOptionsStore } from '@/stores/optionsStore'
import type { CompactItem, EntryCompact, EntryWarning } from '@/api/types'
import { isFolder } from '@/api/types'

interface EntryListProps {
  items: CompactItem[]
  selectedEntryId: string | null
  onFolderClick: (folderId: string, folderName?: string) => void
  onEntryClick: (entryId: string) => void
}

// Icon | Name | Login | Type (md+) | URL (lg+) | Updated
const GRID_COLS = 'grid-cols-[auto_1fr_minmax(80px,1fr)_100px] md:grid-cols-[auto_1fr_minmax(100px,1fr)_90px_100px] lg:grid-cols-[auto_1fr_minmax(120px,1fr)_90px_minmax(140px,1.2fr)_100px]'

/** Render the column-header sort indicator for a given field. */
function SortIcon({ field, sortConfig }: { field: SortField; sortConfig: SortConfig }) {
  if (sortConfig.field !== field) return <ArrowUpDown className="h-3 w-3 opacity-40" />
  return sortConfig.direction === 'asc' ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  )
}

interface EntryRowProps {
  item: CompactItem
  isSelected: boolean
  language: string
  openUrlLabel: string
  onFolderClick: (folderId: string, folderName?: string) => void
  onEntryClick: (entryId: string) => void
  onOpenUrl: (entry: EntryCompact) => void
}

const EntryRow = memo(function EntryRow({
  item,
  isSelected,
  language,
  openUrlLabel,
  onFolderClick,
  onEntryClick,
  onOpenUrl,
}: EntryRowProps) {
  const { t } = useTranslation()
  const folder = isFolder(item)
  const safeHref = !folder && item.url ? getSafeHref(item.url) : null

  return (
    <button
      onClick={() => (folder ? onFolderClick(item.id, item.name) : onEntryClick(item.id))}
      className={`group grid w-full ${GRID_COLS} items-center gap-x-3 px-3 py-2 text-left transition-colors hover:bg-accent ${
        isSelected ? 'bg-primary/10 ring-1 ring-inset ring-primary/20' : ''
      }`}
    >
      {/* Icon */}
      <EntryIcon type={item.type} icon={item.icon} databaseIcon={item.database_icon} />

      {/* Name */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium">{item.name}</span>
        {item.has_second_pass && (
          <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {!folder && item.has_otp && (
          <span
            role="img"
            aria-label={t('entry.oneTimeCode.hasCode')}
            title={t('entry.oneTimeCode.hasCode')}
            className="flex shrink-0"
          >
            <KeyRound className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </span>
        )}
      </div>

      {/* Login */}
      <div className="min-w-0">
        {!folder && item.login && (
          <span className="truncate text-sm text-muted-foreground">{item.login}</span>
        )}
      </div>

      {/* Type — hidden on small screens */}
      <span className="hidden truncate text-xs text-muted-foreground md:block">
        {t(`entryType.${item.type}`)}
      </span>

      {/* URL — hidden on small/medium screens */}
      <div className="hidden min-w-0 lg:block">
        {!folder && item.url && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <span className="truncate">{stripProtocol(item.url)}</span>
            {safeHref && (
              <span
                role="button"
                tabIndex={-1}
                aria-label={openUrlLabel}
                title={openUrlLabel}
                className="pointer-events-none shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenUrl(item)
                }}
              >
                <ExternalLink className="h-3 w-3" />
              </span>
            )}
          </span>
        )}
      </div>

      {/* Updated */}
      <span className="text-xs text-muted-foreground">
        {formatRelativeDate(item.updated_at, language)}
      </span>
    </button>
  )
})

export function EntryList({ items, selectedEntryId, onFolderClick, onEntryClick }: EntryListProps) {
  const { t, i18n } = useTranslation()
  const sortConfig = useOptionsStore((s) => s.entryListSort)
  const setSortConfig = useOptionsStore((s) => s.setEntryListSort)
  const sortedItems = useSortedItems(items, sortConfig)
  const openUrlLabel = t('entryList.openUrl')

  // The parent (VaultPage) may pass freshly-allocated callbacks on every
  // render. Wrap them in stable identities (latest values held in a ref) so the
  // memoized EntryRow only re-renders when its own item/selection changes —
  // selecting a row must not re-render all (up to 5000) sibling rows. The refs
  // are updated in an effect (never during render) to stay concurrent-safe.
  const onFolderClickRef = useRef(onFolderClick)
  const onEntryClickRef = useRef(onEntryClick)
  useEffect(() => {
    onFolderClickRef.current = onFolderClick
    onEntryClickRef.current = onEntryClick
  })

  const stableFolderClick = useCallback(
    (folderId: string, folderName?: string) => onFolderClickRef.current(folderId, folderName),
    [],
  )
  const stableEntryClick = useCallback((entryId: string) => onEntryClickRef.current(entryId), [])

  // Conditional access (Server 20.0.0+): the row's open-URL icon is the one
  // way to use an entry without opening its detail, so the warning is shown
  // here too. A confirm or verify warning opens nothing until it is answered;
  // an info warning is shown as it opens (sticky - the new tab takes the
  // focus, and a toast that timed out behind it would never be read).
  const toast = useToast()
  const [urlPrompt, setUrlPrompt] = useState<{ entry: EntryCompact; warning: EntryWarning } | null>(
    null,
  )
  const handleOpenUrl = useCallback(
    (entry: EntryCompact) => {
      const warning = entry.warning
      if (isBlockingWarning(warning)) {
        setUrlPrompt({ entry, warning })
        return
      }
      if (warning) {
        toast.warning(warningMessageText(warning), {
          title: t('entry.conditionalAccess.title'),
          duration: 0,
        })
      }
      openSafeUrl(entry.url)
    },
    [toast, t],
  )

  function handleSort(field: SortField) {
    setSortConfig({
      field,
      direction: sortConfig.field === field && sortConfig.direction === 'asc' ? 'desc' : 'asc',
    })
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <FolderIcon className="mb-2 h-10 w-10" />
        <p>{t('vault.noEntries')}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Column headers */}
      <div className={`grid ${GRID_COLS} items-center gap-x-3 border-b px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase`}>
        {/* Icon spacer */}
        <div className="w-5" />

        {/* Name */}
        <button
          onClick={() => handleSort('name')}
          className="flex items-center gap-1 hover:text-foreground"
        >
          {t('entryList.name')}
          <SortIcon field="name" sortConfig={sortConfig} />
        </button>

        {/* Login */}
        <button
          onClick={() => handleSort('login')}
          className="flex items-center gap-1 hover:text-foreground"
        >
          {t('entryList.login')}
          <SortIcon field="login" sortConfig={sortConfig} />
        </button>

        {/* Type — hidden on small screens */}
        <button
          onClick={() => handleSort('type')}
          className="hidden items-center gap-1 hover:text-foreground md:flex"
        >
          {t('entryList.type')}
          <SortIcon field="type" sortConfig={sortConfig} />
        </button>

        {/* URL — hidden on small/medium screens */}
        <button
          onClick={() => handleSort('url')}
          className="hidden items-center gap-1 hover:text-foreground lg:flex"
        >
          {t('entryList.url')}
          <SortIcon field="url" sortConfig={sortConfig} />
        </button>

        {/* Updated */}
        <button
          onClick={() => handleSort('updated_at')}
          className="flex items-center gap-1 hover:text-foreground"
        >
          {t('entryList.updated')}
          <SortIcon field="updated_at" sortConfig={sortConfig} />
        </button>
      </div>

      {/* Items */}
      <div>
        {sortedItems.map((item) => {
          const folder = isFolder(item)
          const isSelected = !folder && item.id === selectedEntryId

          return (
            <EntryRow
              key={item.id}
              item={item}
              isSelected={isSelected}
              language={i18n.language}
              openUrlLabel={openUrlLabel}
              onFolderClick={stableFolderClick}
              onEntryClick={stableEntryClick}
              onOpenUrl={handleOpenUrl}
            />
          )
        })}
      </div>

      {urlPrompt && (
        <ConditionalAccessPrompt
          key={`${urlPrompt.entry.id}:${warningIdentity(urlPrompt.warning)}`}
          warning={urlPrompt.warning}
          entryName={urlPrompt.entry.name}
          entryType={t(`entryType.${urlPrompt.entry.type}`)}
          onConfirm={() => {
            setUrlPrompt(null)
            openSafeUrl(urlPrompt.entry.url)
          }}
          onCancel={() => setUrlPrompt(null)}
        />
      )}
    </div>
  )
}

/** Strip https:// or http:// for cleaner URL display */
function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '')
}
