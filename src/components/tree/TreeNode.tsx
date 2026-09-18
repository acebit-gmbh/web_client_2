import { useState } from 'react'
import { ChevronRight, Folder, FolderOpen, Lock } from 'lucide-react'
import { useChildren } from '@/hooks/useChildren'
import type { DatabaseIconRef, FolderCompact } from '@/api/types'
import { isFolder } from '@/api/types'
import { getIconUrl } from '@/lib/icons'
import { DatabaseIconImage } from '@/components/icons/DatabaseIconImage'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { focusItem, getVisibleTreeItems, findParent } from './treeKeyboard'

interface TreeNodeProps {
  folder: FolderCompact
  dbId: string
  activeFolderId: string | null
  depth: number
  onFolderClick: (folderId: string, folderName?: string) => void
}

const FOLDER_ICON_SIZE = 'h-4 w-4'

/** The bundled standard icon named by `icon`, else the Folder / FolderOpen glyph. */
function StandardFolderIcon({ icon, expanded }: { icon?: string; expanded: boolean }) {
  // The URL that failed, not a boolean: a sticky flag would keep the glyph
  // for good once one image had failed, even after the folder's icon changed.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const iconUrl = getIconUrl(icon)

  if (iconUrl && failedUrl !== iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={`${FOLDER_ICON_SIZE} shrink-0 object-contain`}
        onError={() => setFailedUrl(iconUrl)}
      />
    )
  }

  return expanded ? (
    <FolderOpen className={`${FOLDER_ICON_SIZE} shrink-0 text-amber-600`} />
  ) : (
    <Folder className={`${FOLDER_ICON_SIZE} shrink-0 text-amber-600`} />
  )
}

interface FolderIconProps {
  dbId: string
  icon?: string
  databaseIcon?: DatabaseIconRef | null
  expanded: boolean
}

/**
 * The icon chain for a folder: database icon -> bundled standard icon named
 * by `icon` -> Folder / FolderOpen glyph. The database-icon component (and
 * with it the image query) is mounted only for folders that have one.
 */
function FolderIcon({ dbId, icon, databaseIcon, expanded }: FolderIconProps) {
  const standard = <StandardFolderIcon icon={icon} expanded={expanded} />
  if (!databaseIcon) return standard
  return (
    <DatabaseIconImage
      icon={databaseIcon}
      dbId={dbId}
      className={FOLDER_ICON_SIZE}
      fallback={standard}
    />
  )
}

export function TreeNode({ folder, dbId, activeFolderId, depth, onFolderClick }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const isActive = folder.id === activeFolderId

  // Lazy-load children only when expanded
  const { data: childrenResponse, isLoading: childrenLoading } = useChildren(
    expanded ? dbId : null,
    folder.id,
  )
  const subFolders = (childrenResponse?.data ?? []).filter(isFolder)
  const hasLoadedChildren = expanded && subFolders.length > 0
  // True once the children query has resolved with zero subfolders: the node is
  // a known leaf, so it must not announce itself as expandable.
  const isKnownLeaf = expanded && childrenResponse !== undefined && subFolders.length === 0

  function handleSelect() {
    onFolderClick(folder.id, folder.name)
    if (!expanded) setExpanded(true)
  }

  function handleChevronClick(e: React.MouseEvent) {
    e.stopPropagation()
    setExpanded(!expanded)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.currentTarget
    const items = getVisibleTreeItems(target)
    const idx = items.indexOf(target)
    if (idx < 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusItem(items[idx + 1])
        break
      case 'ArrowUp':
        e.preventDefault()
        focusItem(items[idx - 1])
        break
      case 'ArrowRight':
        e.preventDefault()
        if (!expanded) {
          // Open the node — children load lazily and become focusable on the
          // next arrow press.
          setExpanded(true)
        } else {
          // Already open: move focus to the first child (next item in DOM).
          focusItem(items[idx + 1])
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (expanded) {
          setExpanded(false)
        } else {
          focusItem(findParent(items, idx))
        }
        break
      case 'Home':
        e.preventDefault()
        focusItem(items[0])
        break
      case 'End':
        e.preventDefault()
        focusItem(items[items.length - 1])
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        handleSelect()
        break
    }
  }

  return (
    <div role="none">
      <div
        role="treeitem"
        tabIndex={isActive ? 0 : -1}
        aria-level={depth}
        aria-selected={isActive}
        aria-expanded={isKnownLeaf ? undefined : expanded}
        onClick={handleSelect}
        onFocus={(e) => {
          // The chevron button bubbles its focusin event up to the treeitem; only
          // react to focus that lands on the treeitem itself, not on descendants.
          if (e.target !== e.currentTarget) return
          // Roving focus: focusing a treeitem also makes it the active selection.
          if (!isActive) onFolderClick(folder.id, folder.name)
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none',
          isActive
            ? 'bg-primary/10 font-medium hover:bg-primary/15 focus-visible:bg-primary/15'
            : 'hover:bg-accent focus-visible:bg-accent',
        )}
        style={{ paddingLeft: `${(depth - 1) * 16 + 8}px` }}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={handleChevronClick}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center',
            // Known leaf: hide the chevron (no children to toggle) while keeping
            // the slot width so labels stay aligned.
            isKnownLeaf && 'invisible',
          )}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        </button>

        <FolderIcon
          dbId={dbId}
          icon={folder.icon}
          databaseIcon={folder.database_icon}
          expanded={expanded}
        />
        <span className="min-w-0 truncate">{folder.name}</span>
        {folder.has_second_pass && <Lock className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />}
      </div>

      {expanded && childrenLoading && (
        <div
          className="py-1"
          style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: '8px' }}
          aria-hidden="true"
        >
          <Skeleton className="h-5 w-full" />
        </div>
      )}

      {hasLoadedChildren && (
        <div role="group">
          {subFolders.map((sub) => (
            <TreeNode
              key={sub.id}
              folder={sub}
              dbId={dbId}
              activeFolderId={activeFolderId}
              depth={depth + 1}
              onFolderClick={onFolderClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}
