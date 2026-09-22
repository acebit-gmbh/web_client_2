import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { getIconUrl } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { TreeNode } from './TreeNode'
import { focusItem, getVisibleTreeItems } from './treeKeyboard'
import { useChildren } from '@/hooks/useChildren'
import { isFolder } from '@/api/types'
import { useRecycleBinCapability } from '@/hooks/useRecycleBinCapability'

interface FolderTreeProps {
  dbId: string | null
  dbName?: string
  activeFolderId: string | null
  onFolderClick: (folderId: string | null, folderName?: string) => void
  /** Whether the recycle bin is the current view, so the item can show it. */
  recycleBinOpen?: boolean
  onRecycleBinClick?: () => void
}

export function FolderTree({
  dbId,
  dbName,
  activeFolderId,
  onFolderClick,
  recycleBinOpen = false,
  onRecycleBinClick,
}: FolderTreeProps) {
  const { t } = useTranslation()
  // Read here rather than prop-drilled: the item exists only where the server
  // keeps a bin, and the capability is already in the cached databases query.
  const recycleBin = useRecycleBinCapability(dbId)

  // Load root-level children to get the top-level folders
  const { data: rootResponse, isLoading } = useChildren(dbId, null)
  const rootFolders = (rootResponse?.data ?? []).filter(isFolder)

  const treeRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Whether the active folder's treeitem is currently rendered (i.e. its
  // ancestors are expanded). When it is not, no descendant carries the roving
  // tabIndex=0, so the root must become the fallback tab stop to keep the tree
  // reachable by keyboard.
  const [activeItemRendered, setActiveItemRendered] = useState(false)

  const isRootActive = activeFolderId === null

  // Detect whether a non-root treeitem is the roving tab stop. We observe the
  // tree's DOM because expansion state lives inside descendant TreeNodes and is
  // not visible to this component through props.
  useEffect(() => {
    const tree = treeRef.current
    if (!tree) return

    const check = () => {
      const stops = tree.querySelectorAll<HTMLElement>('[role="treeitem"][tabindex="0"]')
      let nonRootStop = false
      stops.forEach((el) => {
        if (el !== rootRef.current) nonRootStop = true
      })
      setActiveItemRendered(nonRootStop)
    }

    check()
    const observer = new MutationObserver(check)
    observer.observe(tree, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['tabindex'],
    })
    return () => observer.disconnect()
  }, [dbId, isLoading, activeFolderId])

  if (!dbId) return null

  // Root is the keyboard tab stop when it is the active item, or as a fallback
  // when no rendered descendant carries the roving tabIndex.
  const rootIsTabStop = isRootActive || !activeItemRendered

  function handleRootKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
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
        onFolderClick(null)
        break
    }
  }

  return (
    <div className="p-2">
      <div className="mb-2 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('sidebar.folders')}
      </div>

      {isLoading ? (
        <div className="space-y-1 px-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : (
        <div ref={treeRef} role="tree" aria-label={t('sidebar.treeLabel')} className="space-y-0.5">
          {/* Database root */}
          <div
            ref={rootRef}
            role="treeitem"
            tabIndex={rootIsTabStop ? 0 : -1}
            aria-level={1}
            aria-selected={isRootActive}
            onClick={() => onFolderClick(null)}
            onFocus={() => {
              if (!isRootActive) onFolderClick(null)
            }}
            onKeyDown={handleRootKeyDown}
            className={cn(
              'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none',
              isRootActive
                ? 'bg-primary/10 font-medium hover:bg-primary/15 focus-visible:bg-primary/15'
                : 'hover:bg-accent focus-visible:bg-accent',
            )}
          >
            <img src={getIconUrl('ico4.svg')} alt="" className="h-4 w-4 shrink-0" />
            <span className="truncate">{dbName || t('sidebar.root')}</span>
          </div>

          {/* Top-level folders */}
          {rootFolders.map((folder) => (
            <TreeNode
              key={folder.id}
              folder={folder}
              dbId={dbId}
              activeFolderId={activeFolderId}
              depth={2}
              onFolderClick={onFolderClick}
            />
          ))}
        </div>
      )}

      {/* The recycle bin is not a folder, so it sits outside the tree: it has
          no place in the folder hierarchy and must not take part in the tree's
          roving tab stop. Shown only where the server keeps a bin. */}
      {recycleBin?.enabled && onRecycleBinClick && (
        <>
          <Separator className="my-2" />
          <button
            type="button"
            onClick={onRecycleBinClick}
            aria-current={recycleBinOpen ? 'true' : undefined}
            className={cn(
              'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none',
              recycleBinOpen
                ? 'bg-primary/10 font-medium hover:bg-primary/15 focus-visible:bg-primary/15'
                : 'hover:bg-accent focus-visible:bg-accent',
            )}
          >
            <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{t('sidebar.recycleBin')}</span>
          </button>
        </>
      )}
    </div>
  )
}
