import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EntryIcon } from '@/components/entries/EntryIcon'
import { DatabaseIconImage } from '@/components/icons/DatabaseIconImage'
import { IconUploadPanel, type IconUploadDraft } from '@/components/icons/IconUploadPanel'
import { useDatabaseIcons } from '@/hooks/useDatabaseIcons'
import { useUploadDatabaseIcon } from '@/hooks/mutations/useIconMutations'
import { isDatabaseIconId } from '@/api/icons'
import { describeIconUploadError } from '@/lib/apiErrors'
import {
  effectiveIconSelection,
  isSameIconName,
  type IconChoice,
  type IconSelection,
} from '@/lib/iconChoice'
import { getIconUrl, standardIconFile, STANDARD_ICON_COUNT } from '@/lib/icons'
import type { DatabaseIcon, DatabaseIconRef, DatabaseIconsCapability, EntryType } from '@/api/types'

export type IconPickerTab = 'standard' | 'database' | 'upload'

/** What the entry form may ask of the picker. */
export interface IconPickerHandle {
  /** True while an image is chosen but not uploaded - saving now would silently drop it. */
  hasPendingUpload: () => boolean
  /** Opens the picker on a tab (the form does this when the server refused the chosen icon). */
  open: (tab: IconPickerTab) => void
}

interface IconPickerProps {
  ref?: Ref<IconPickerHandle>
  /** Database of the entry: the icons offered, and the upload target. */
  dbId: string
  /** The database's `icons` object. The caller renders the picker only when it exists. */
  capability: DatabaseIconsCapability
  entryType: EntryType
  /** The icon the loaded entry has (a new entry: the type default). */
  stored: IconSelection
  /** `icon` of the loaded entry - the standard icon shown when its database icon cannot be. */
  storedIconFile?: string
  value: IconChoice
  onChange: (next: IconChoice) => void
  /** The URL in the form; its host is the suggested name of an uploaded icon. */
  entryUrl?: string | null
  disabled?: boolean
}

const STANDARD_INDEXES = Array.from({ length: STANDARD_ICON_COUNT }, (_, index) => index)

/** The name filter appears once the database has more icons than fit a glance. */
const FILTER_THRESHOLD = 24

const TILE_CLASS =
  'hover:bg-muted focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-muted flex h-10 w-10 items-center justify-center rounded-md border border-transparent focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'

const GRID_CLASS =
  'grid max-h-52 grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1 overflow-y-auto p-0.5'

/**
 * Icon row of the entry form plus the picker it unfolds (Server 20.0.0+,
 * entries only). Three sources: the 135 standard icons bundled with the
 * client, the icons stored in the entry's database, and - when the database
 * says `can_upload` - a new image.
 *
 * The parent owns the choice (see IconChoice) and turns it into the request
 * body; nothing is written here except an upload, which is a request of its
 * own, made when the user asks for it and before the entry is saved. The
 * uploaded icon is selected under the name THE SERVER answered.
 */
export function IconPicker({
  ref,
  dbId,
  capability,
  entryType,
  stored,
  storedIconFile,
  value,
  onChange,
  entryUrl,
  disabled = false,
}: IconPickerProps) {
  const { t } = useTranslation()
  const panelId = useId()
  const labelId = useId()
  const canUpload = capability.can_upload === true
  const selection = effectiveIconSelection(value, stored)

  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<IconPickerTab>('standard')
  const [draft, setDraft] = useState<IconUploadDraft | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const upload = useUploadDatabaseIcon(dbId)

  useImperativeHandle(
    ref,
    () => ({
      hasPendingUpload: () => draft !== null,
      open: (nextTab) => {
        setTab(nextTab)
        setOpen(true)
      },
    }),
    [draft],
  )

  const activeTab: IconPickerTab = tab === 'upload' && !canUpload ? 'standard' : tab

  function toggle() {
    if (!open) setTab(selection.kind === 'custom' ? 'database' : 'standard')
    setOpen(!open)
  }

  /** A pick from a grid, or the undo: whatever image was waiting to be uploaded is no longer wanted. */
  function choose(next: IconChoice) {
    setDraft(null)
    setUploadError(null)
    setNotice(null)
    onChange(next)
  }

  function handleDraftChange(next: IconUploadDraft | null) {
    setUploadError(null)
    setDraft(next)
  }

  async function handleUpload() {
    if (!draft || upload.isPending) return
    const requested = draft.name.trim()
    setUploadError(null)
    setNotice(null)
    try {
      const icon = await upload.mutateAsync({
        name: requested,
        data: draft.prepared.data,
        previewUrl: draft.prepared.previewUrl,
      })
      setDraft(null)
      setOpen(false)
      // The button that was just pressed is inside the panel that closes here.
      // Without this, focus would fall out of the picker entirely and a
      // keyboard user would have to tab through the whole form to get back.
      toggleRef.current?.focus()
      // The server keeps an existing icon of that name untouched and stores a
      // different picture next to it; say so, the name is what the user sees.
      if (!isSameIconName(icon.name, requested)) {
        setNotice(t('entryForm.icon.storedAs', { name: icon.name }))
      }
      onChange({ kind: 'custom', icon })
    } catch (err) {
      setUploadError(describeIconUploadError(err, t))
    }
  }

  let description: string
  if (selection.kind === 'standard') {
    description = t('entryForm.icon.descStandard', { number: selection.index + 1 })
  } else if (selection.kind === 'custom') {
    // A stored name that no longer resolves (the icon was removed in the
    // meantime): the entry shows its standard icon, and the row says why.
    description = selection.icon
      ? t('entryForm.icon.descCustom', { name: selection.icon.name })
      : t('entryForm.icon.descMissing')
  } else {
    description = t('entryForm.icon.descDefault')
  }

  return (
    <div className="space-y-2" role="group" aria-labelledby={labelId}>
      <div id={labelId} className="text-sm leading-none font-medium">
        {t('entryForm.icon.title')}
      </div>
      <div className="flex items-center gap-3">
        <SelectionPreview
          selection={selection}
          entryType={entryType}
          dbId={dbId}
          // The type default is only known when the server named it: `icon`
          // of an entry with a database icon is its type default.
          fallbackIconFile={stored.kind === 'custom' ? storedIconFile : undefined}
        />
        <span className="min-w-0 flex-1 truncate text-sm" title={description}>
          {description}
        </span>
        {value.kind !== 'unchanged' && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => choose({ kind: 'unchanged' })}
            disabled={disabled || upload.isPending}
          >
            {t('entryForm.icon.undo')}
          </Button>
        )}
        <Button
          ref={toggleRef}
          type="button"
          variant="outline"
          size="xs"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          disabled={disabled}
        >
          {open ? t('entryForm.icon.done') : t('entryForm.icon.change')}
        </Button>
      </div>
      {/* What will be written changed under the user's hands (`image_name` is
          now "example.com (2)"), and the panel that asked for it is gone:
          announce it, like every other asynchronous message of this feature. */}
      {notice && (
        <p role="status" className="text-muted-foreground text-xs">
          {notice}
        </p>
      )}

      {open && (
        <div id={panelId} className="rounded-md border p-3">
          <Tabs value={activeTab} onValueChange={(next) => setTab(next as IconPickerTab)}>
            <TabsList className={`grid w-full ${canUpload ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <TabsTrigger value="standard">{t('entryForm.icon.tabStandard')}</TabsTrigger>
              <TabsTrigger value="database">{t('entryForm.icon.tabDatabase')}</TabsTrigger>
              {canUpload && (
                <TabsTrigger value="upload">{t('entryForm.icon.tabUpload')}</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="standard" className="mt-3">
              <StandardIconGrid selection={selection} onChoose={choose} disabled={disabled} />
            </TabsContent>

            <TabsContent value="database" className="mt-3">
              <DatabaseIconGrid
                dbId={dbId}
                selection={selection}
                canUpload={canUpload}
                onChoose={choose}
                disabled={disabled}
              />
            </TabsContent>

            {canUpload && (
              <TabsContent value="upload" className="mt-3">
                <IconUploadPanel
                  maxBytes={capability.max_bytes}
                  entryUrl={entryUrl}
                  draft={draft}
                  onDraftChange={handleDraftChange}
                  onUpload={() => void handleUpload()}
                  isUploading={upload.isPending}
                  uploadError={uploadError}
                  disabled={disabled}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}
    </div>
  )
}

// ─── Preview ─────────────────────────────────────────────────

interface SelectionPreviewProps {
  selection: IconSelection
  entryType: EntryType
  dbId: string
  fallbackIconFile?: string
}

/** The selected icon through the same chain the lists use: database icon -> standard icon -> type glyph. */
function SelectionPreview({ selection, entryType, dbId, fallbackIconFile }: SelectionPreviewProps) {
  const className = 'h-8 w-8'
  if (selection.kind === 'standard') {
    return (
      <EntryIcon type={entryType} icon={standardIconFile(selection.index)} className={className} />
    )
  }
  return (
    <EntryIcon
      type={entryType}
      icon={fallbackIconFile}
      databaseIcon={selection.kind === 'custom' ? selection.icon : null}
      dbId={dbId}
      className={className}
    />
  )
}

// ─── Grids ───────────────────────────────────────────────────

/**
 * Arrow keys inside a tile grid. Only one tile of a grid is a tab stop, so
 * 135 icons do not mean 135 presses of Tab; `onMove` reports the tile the
 * focus went to, and the tab stop follows it (WAI-ARIA roving tabindex) -
 * without that, leaving the grid and coming back would start over at the
 * selected tile.
 *
 * Disabled tiles are skipped: `.focus()` is a no-op on them, which would
 * swallow the keystroke after preventDefault().
 */
function handleTileKeys(
  e: React.KeyboardEvent<HTMLDivElement>,
  onMove: (tile: HTMLButtonElement) => void,
) {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const tiles = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
  )
  const current = tiles.indexOf(document.activeElement as HTMLButtonElement)
  if (current < 0) return

  // The grid wraps on its own; the tiles of the first row tell how wide it is.
  let columns = tiles.findIndex((tile) => tile.offsetTop !== tiles[0].offsetTop)
  if (columns < 1) columns = tiles.length

  let next = current
  if (e.key === 'ArrowRight') next = current + 1
  else if (e.key === 'ArrowLeft') next = current - 1
  else if (e.key === 'ArrowDown') next = current + columns
  else if (e.key === 'ArrowUp') next = current - columns
  else if (e.key === 'Home') next = 0
  else next = tiles.length - 1

  e.preventDefault()
  if (next < 0 || next >= tiles.length) return
  tiles[next].focus()
  onMove(tiles[next])
}

interface GridProps {
  selection: IconSelection
  onChoose: (next: IconChoice) => void
  disabled: boolean
}

function StandardIconGrid({ selection, onChoose, disabled }: GridProps) {
  const { t } = useTranslation()
  const selectedIndex = selection.kind === 'standard' ? selection.index : -1
  // Where the arrow keys left the focus; until then the selected tile (else
  // the first one) is the single tab stop.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const tabStop =
    focusedIndex !== null && focusedIndex < STANDARD_ICON_COUNT
      ? focusedIndex
      : selectedIndex >= 0
        ? selectedIndex
        : 0

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={selection.kind === 'default'}
        className="aria-pressed:border-primary"
        onClick={() => onChoose({ kind: 'default' })}
        disabled={disabled}
      >
        {t('entryForm.icon.defaultForType')}
      </Button>
      <div
        role="group"
        aria-label={t('entryForm.icon.standardGroup')}
        className={GRID_CLASS}
        onKeyDown={(e) =>
          handleTileKeys(e, (tile) => setFocusedIndex(Number(tile.dataset.iconIndex)))
        }
      >
        {STANDARD_INDEXES.map((index) => {
          const label = t('entryForm.icon.standardIcon', { number: index + 1 })
          return (
            <button
              key={index}
              type="button"
              className={TILE_CLASS}
              data-icon-index={index}
              aria-pressed={index === selectedIndex}
              aria-label={label}
              title={label}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => onChoose({ kind: 'standard', index })}
              disabled={disabled}
            >
              <img
                src={getIconUrl(standardIconFile(index))}
                alt=""
                loading="lazy"
                className="h-7 w-7 object-contain"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Tells a tile, once, that it has scrolled into view - one observer for the
 * whole grid. Without IntersectionObserver every tile counts as seen.
 */
class SeenTracker {
  readonly supported = typeof IntersectionObserver !== 'undefined'
  private readonly callbacks = new Map<Element, () => void>()
  private observer: IntersectionObserver | null = null

  /** The observer is created with the first tile and again after a dispose(). */
  private ensureObserver(): IntersectionObserver | null {
    if (!this.supported) return null
    this.observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const seen = this.callbacks.get(entry.target)
        this.forget(entry.target)
        seen?.()
      }
    })
    return this.observer
  }

  /** Returns the undo, in the shape of a ref-callback cleanup. */
  watch(element: Element, seen: () => void): () => void {
    this.callbacks.set(element, seen)
    this.ensureObserver()?.observe(element)
    return () => this.forget(element)
  }

  /**
   * The grid went away (a tab switch unmounts it). Watching again revives the
   * observer, so this survives StrictMode's mount / unmount / mount.
   */
  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
    this.callbacks.clear()
  }

  private forget(element: Element): void {
    this.callbacks.delete(element)
    this.observer?.unobserve(element)
  }
}

/** The listed icons this client can address and assign; anything else in the answer is ignored. */
function usableIcons(items: readonly DatabaseIcon[] | undefined): DatabaseIconRef[] {
  const byId = new Map<string, DatabaseIconRef>()
  for (const item of items ?? []) {
    if (
      isDatabaseIconId(item?.id) &&
      typeof item.name === 'string' &&
      item.name !== '' &&
      typeof item.version === 'string' &&
      item.version !== '' &&
      !byId.has(item.id)
    ) {
      byId.set(item.id, { id: item.id, name: item.name, version: item.version })
    }
  }
  return [...byId.values()]
}

interface DatabaseIconGridProps extends GridProps {
  dbId: string
  canUpload: boolean
}

function DatabaseIconGrid({
  dbId,
  selection,
  canUpload,
  onChoose,
  disabled,
}: DatabaseIconGridProps) {
  const { t } = useTranslation()
  const { data, isLoading, isError, refetch } = useDatabaseIcons(dbId)
  const [filter, setFilter] = useState('')
  const [tracker] = useState(() => new SeenTracker())
  // Where the arrow keys left the focus, by icon id (see handleTileKeys).
  const [focusedId, setFocusedId] = useState<string | null>(null)
  useEffect(() => () => tracker.dispose(), [tracker])

  const icons = useMemo(() => usableIcons(data?.data), [data])
  const needle = filter.trim().toLowerCase()
  const shown = needle ? icons.filter((icon) => icon.name.toLowerCase().includes(needle)) : icons

  if (isLoading) {
    return <p className="text-muted-foreground text-xs">{t('entryForm.icon.listLoading')}</p>
  }
  if (isError) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-destructive text-xs">
          {t('entryForm.icon.listFailed')}
        </p>
        <Button type="button" variant="outline" size="xs" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }
  if (icons.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {canUpload ? t('entryForm.icon.listEmptyUpload') : t('entryForm.icon.listEmpty')}
      </p>
    )
  }

  const selectedName = selection.kind === 'custom' ? selection.name : null
  const isSelected = (icon: DatabaseIconRef) =>
    selectedName !== null && isSameIconName(icon.name, selectedName)
  const tabStopId =
    focusedId !== null && shown.some((icon) => icon.id === focusedId)
      ? focusedId
      : (shown.find(isSelected) ?? shown[0])?.id

  return (
    <div className="space-y-2">
      {icons.length > FILTER_THRESHOLD && (
        <Input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            // Not a form of its own: Enter must not save the entry.
            if (e.key === 'Enter') e.preventDefault()
          }}
          placeholder={t('entryForm.icon.filter')}
          aria-label={t('entryForm.icon.filter')}
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
        />
      )}
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('entryForm.icon.noMatch')}</p>
      ) : (
        <div
          role="group"
          aria-label={t('entryForm.icon.databaseGroup')}
          className={GRID_CLASS}
          onKeyDown={(e) => handleTileKeys(e, (tile) => setFocusedId(tile.dataset.iconId ?? null))}
        >
          {shown.map((icon) => (
            <DatabaseIconTile
              key={icon.id}
              icon={icon}
              dbId={dbId}
              tracker={tracker}
              selected={isSelected(icon)}
              tabStop={icon.id === tabStopId}
              onChoose={onChoose}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface DatabaseIconTileProps {
  icon: DatabaseIconRef
  dbId: string
  tracker: SeenTracker
  selected: boolean
  tabStop: boolean
  onChoose: (next: IconChoice) => void
  disabled: boolean
}

/**
 * One icon of the database. Its image is asked for only once the tile has
 * been on screen: a database can hold a thousand icons, and the image hook
 * mounted for all of them would fetch them all. Tiles that are visible
 * together still share one batched request (see DbIconBatcher).
 */
function DatabaseIconTile({
  icon,
  dbId,
  tracker,
  selected,
  tabStop,
  onChoose,
  disabled,
}: DatabaseIconTileProps) {
  const [seen, setSeen] = useState(!tracker.supported)
  const watch = useCallback(
    (element: HTMLButtonElement | null) => {
      if (!element) return
      return tracker.watch(element, () => setSeen(true))
    },
    [tracker],
  )
  const placeholder = <span className="bg-muted h-7 w-7 rounded" aria-hidden="true" />

  return (
    <button
      ref={watch}
      type="button"
      className={TILE_CLASS}
      data-icon-id={icon.id}
      aria-pressed={selected}
      aria-label={icon.name}
      title={icon.name}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => onChoose({ kind: 'custom', icon })}
      disabled={disabled}
    >
      {seen ? (
        <DatabaseIconImage icon={icon} dbId={dbId} className="h-7 w-7" fallback={placeholder} />
      ) : (
        placeholder
      )}
    </button>
  )
}
