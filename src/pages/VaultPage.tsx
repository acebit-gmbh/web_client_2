import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { VaultShell } from '@/components/layout/VaultShell'
import { StatusBar } from '@/components/layout/StatusBar'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { FolderTree } from '@/components/tree/FolderTree'
import { EntryList } from '@/components/entries/EntryList'
import { EntryDetail } from '@/components/entries/EntryDetail'
import { EntryFormDialog } from '@/components/entries/EntryFormDialog'
import { InfoPanel } from '@/components/entries/InfoPanel'
import { SearchResults } from '@/components/search/SearchResults'
import { SessionExpiryWarning } from '@/components/session/SessionExpiryWarning'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { CreateMenu } from '@/components/common/CreateMenu'
import { UploadProgressDialog } from '@/components/common/UploadProgressDialog'
import { FolderFormDialog } from '@/components/folders/FolderFormDialog'
import { FolderPicker } from '@/components/folders/FolderPicker'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { AlertCircle, RotateCw } from 'lucide-react'
import { RecycleBinView } from '@/components/recyclebin/RecycleBinView'
import { useNavigationStore } from '@/stores/navigationStore'
import { useAuthStore } from '@/stores/authStore'
import { useVaultAppBar } from '@/hooks/useVaultAppBar'
import { useDatabases } from '@/hooks/useDatabases'
import { useChildren } from '@/hooks/useChildren'
import { useEntry } from '@/hooks/useEntry'
import { useSearch } from '@/hooks/useSearch'
import { useSessionWatchdog } from '@/hooks/useSessionWatchdog'
import { useAutoLock } from '@/hooks/useAutoLock'
import { useToast } from '@/hooks/useToast'
import { useDialogTrigger } from '@/hooks/useDialogTrigger'
import { useOptionsStore } from '@/stores/optionsStore'
import { describeApiError } from '@/lib/apiErrors'
import { useCreateEntry, useUpdateEntry, useDeleteEntry, useMoveEntry } from '@/hooks/mutations/useEntryMutations'
import {
  useCreateFolder,
  useUpdateFolder,
  useMoveFolder,
  useDeleteFolder,
} from '@/hooks/mutations/useFolderMutations'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import { createEntry, uploadDocument, deleteEntry, MAX_DOCUMENT_SIZE } from '@/api/entries'
import { ApiError } from '@/api/client'
import { formatBytes } from '@/lib/format'
import { isEntry, type EntryCompact, type EntryType } from '@/api/types'

interface UploadState {
  fileName: string
  progress: number
  controller: AbortController
}

// Module-scope so it isn't re-created each render (react-hooks/static-components).
function ContentError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string
  retryLabel: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}

const LAST_DB_KEY = 'pd-last-db'
const SESSION_TIMEOUT_MS = 10 * 60 * 1000
const WARNING_BEFORE_MS = 2 * 60 * 1000

export default function VaultPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [showExpiryWarning, setShowExpiryWarning] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // CRUD dialog states
  // All form dialogs are conditionally mounted via useDialogTrigger so each
  // open is a fresh component instance — this prevents stale field values
  // from leaking between successive opens (e.g. a "new entry" form being
  // pre-filled with whatever the user typed last time). The hook also
  // captures the trigger element so focus returns to it on close.
  const newEntryDialog = useDialogTrigger()
  const [newEntryType, setNewEntryType] = useState<EntryType>('password')
  const editEntryDialog = useDialogTrigger()
  const moveEntryDialog = useDialogTrigger()
  const [showDeleteEntry, setShowDeleteEntry] = useState(false)
  const newFolderDialog = useDialogTrigger()
  const editFolderDialog = useDialogTrigger()
  const moveFolderDialog = useDialogTrigger()
  const deleteFolderDialog = useDialogTrigger()
  const [uploadState, setUploadState] = useState<UploadState | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const queryClient = useQueryClient()

  const {
    currentDatabaseId,
    currentFolderId,
    currentFolderName,
    selectedEntryId,
    recycleBinOpen,
    setDatabase,
    setFolder,
    selectEntry,
    openRecycleBin,
  } = useNavigationStore()

  const {
    data: databasesResponse,
    isLoading: loadingDbs,
    isError: dbError,
    refetch: refetchDatabases,
  } = useDatabases()
  // Stable identity so effects depending on `databases` don't re-run every render.
  const databases = useMemo(() => databasesResponse?.data ?? [], [databasesResponse])

  const {
    data: childrenResponse,
    isLoading: loadingChildren,
    isError: childrenIsError,
    error: childrenError,
    refetch: refetchChildren,
  } = useChildren(currentDatabaseId, currentFolderId)

  // Search
  const isSearching = searchQuery.trim().length >= 3
  const {
    data: searchResponse,
    isLoading: searchQueryLoading,
    isError: searchIsError,
  } = useSearch(currentDatabaseId, searchQuery)
  // The query is disabled during the 300ms debounce window (so isLoading is
  // false with no data) — treat that as loading too, otherwise a "no results"
  // empty state flashes before every search actually starts.
  const loadingSearch = isSearching && (searchQueryLoading || searchResponse === undefined)

  const currentDb = databases.find((db) => db.id === currentDatabaseId)

  // Mutation hooks
  const createEntryMut = useCreateEntry(currentDatabaseId ?? '')
  const updateEntryMut = useUpdateEntry(currentDatabaseId ?? '')
  const deleteEntryMut = useDeleteEntry(currentDatabaseId ?? '')
  const moveEntryMut = useMoveEntry(currentDatabaseId ?? '')
  const createFolderMut = useCreateFolder(currentDatabaseId ?? '')
  const updateFolderMut = useUpdateFolder(currentDatabaseId ?? '')
  const moveFolderMut = useMoveFolder(currentDatabaseId ?? '')
  const deleteFolderMut = useDeleteFolder(currentDatabaseId ?? '')

  // Second password for the selected entry (if previously unlocked)
  const selectedSecondPassword = useSecondPasswordStore(
    (s) => selectedEntryId ? s.getSecondPassword(selectedEntryId) : undefined,
  )

  // Fetch full entry for editing (with second password if needed)
  const { data: editingEntry } = useEntry(
    currentDatabaseId,
    editEntryDialog.isOpen ? selectedEntryId : null,
    selectedSecondPassword,
  )

  // Register vault props with AppBar
  useVaultAppBar({
    databases,
    currentDatabaseId,
    onDatabaseChange: setDatabase,
    searchQuery,
    onSearchChange: setSearchQuery,
    onMenuClick: () => setSidebarOpen(true),
  })

  // Auto-select database on first load
  useEffect(() => {
    if (databases.length === 0 || currentDatabaseId) return
    const lastDbId = localStorage.getItem(LAST_DB_KEY)
    const hasLastDb = lastDbId && databases.some((db) => db.id === lastDbId)
    setDatabase(hasLastDb ? lastDbId! : databases[0].id)
  }, [databases, currentDatabaseId, setDatabase])

  // Persist last database
  useEffect(() => {
    if (currentDatabaseId) {
      localStorage.setItem(LAST_DB_KEY, currentDatabaseId)
    }
  }, [currentDatabaseId])

  function handleRecycleBinClick() {
    openRecycleBin()
    // The bin is a view of the whole database, so a search would be answering
    // a different question; and on a phone the sidebar has to get out of the
    // way, exactly as it does for a folder.
    setSearchQuery('')
    setSidebarOpen(false)
  }

  function handleFolderClick(folderId: string | null, folderName?: string) {
    // Look up the name from current items or breadcrumbs if not provided
    let name = folderName
    if (folderId && !name) {
      const folder = items.find((item) => item.id === folderId)
      if (folder) name = folder.name
      const breadcrumb = breadcrumbs.find((seg) => seg.id === folderId)
      if (breadcrumb) name = breadcrumb.name
    }
    setFolder(folderId, name)
    setSearchQuery('')
    // Close the mobile sidebar sheet so it doesn't cover the folder we just
    // navigated to (no-op on desktop where the sidebar is always visible).
    setSidebarOpen(false)
  }

  // If the current folder was deleted elsewhere, its children query 404s —
  // bounce to the database root instead of showing a misleading empty folder.
  useEffect(() => {
    if (childrenError instanceof ApiError && childrenError.status === 404 && currentFolderId) {
      setFolder(null)
      toast.error(t('toast.folderGone'))
    }
  }, [childrenError, currentFolderId, setFolder, toast, t])

  // Document upload: pre-flight size check, create entry + upload content
  // with progress, surface success / failure / abort via toast.
  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !currentDatabaseId) return

    // Reset file input so the same file can be re-selected
    e.target.value = ''

    if (file.size > MAX_DOCUMENT_SIZE) {
      toast.error(t('toast.fileTooLarge', { max: formatBytes(MAX_DOCUMENT_SIZE) }), {
        title: t('toast.fileTooLargeTitle'),
      })
      return
    }

    const controller = new AbortController()
    setUploadState({ fileName: file.name, progress: 0, controller })

    // Bypass the create-entry toast — the user only cares about the
    // end-to-end upload result, so we call the API function directly and
    // emit a single toast at the end.
    let createdEntryId: string | null = null
    try {
      const entry = await createEntry(currentDatabaseId, {
        type: 'document',
        name: file.name,
      }, currentFolderId)
      createdEntryId = entry.id

      await uploadDocument(currentDatabaseId, entry.id, file, {
        signal: controller.signal,
        onProgress: (fraction) => {
          setUploadState((prev) => prev && { ...prev, progress: fraction })
        },
      })

      queryClient.invalidateQueries({ queryKey: ['children', currentDatabaseId] })
      toast.success(t('toast.uploadSucceeded'))
    } catch (err) {
      // The entry is created before its content is uploaded; if the upload is
      // cancelled or fails, delete the now content-less entry so it doesn't
      // linger as a mystery empty document. Best-effort.
      if (createdEntryId) {
        try {
          // 'permanent': as far as the user is concerned this entry never
          // existed, and a half-made document in the recycle bin would be one
          // more mystery rather than one fewer.
          await deleteEntry(currentDatabaseId, createdEntryId, 'permanent')
        } catch {
          // Leave it if the cleanup itself fails — nothing more we can do.
        }
      }
      queryClient.invalidateQueries({ queryKey: ['children', currentDatabaseId] })
      // User-initiated cancel: silent (but the orphan was still cleaned up).
      if (err instanceof DOMException && err.name === 'AbortError') return
      toast.error(describeApiError(err, t), {
        title: t('toast.uploadFailed'),
      })
    } finally {
      setUploadState(null)
    }
  }

  function handleUploadCancel() {
    uploadState?.controller.abort()
    setUploadState(null)
  }

  // Session watchdog
  const handleSessionWarning = useCallback(() => {
    setShowExpiryWarning(true)
  }, [])

  // Server-side inactivity expiry: the token is already dead, so don't try to
  // revoke it (it would just 401) and don't broadcast — other tabs hold their
  // own independent sessions.
  const handleSessionExpired = useCallback(() => {
    setShowExpiryWarning(false)
    useAuthStore.getState().logout({ broadcast: false, revoke: false })
    navigate('/login', { replace: true })
  }, [navigate])

  // Client-side auto-lock: the server session may still be alive, so revoke it
  // (that is the whole point of auto-lock) — but still don't broadcast, or an
  // idle background tab would force-log-out the user's active tab.
  const handleAutoLock = useCallback(() => {
    setShowExpiryWarning(false)
    useAuthStore.getState().logout({ broadcast: false, revoke: true })
    navigate('/login', { replace: true })
  }, [navigate])

  useSessionWatchdog({
    onWarning: handleSessionWarning,
    onExpired: handleSessionExpired,
  })

  // User-configured auto-lock — fires on real input idleness (independent of
  // the API-driven session watchdog above).
  const autoLockMinutes = useOptionsStore((s) => s.autoLockMinutes)
  useAutoLock(autoLockMinutes, handleAutoLock)

  // Auto-dismiss the expiry warning if a successful API call (e.g. a background
  // refetch on tab focus) reset the session timer back outside the warning
  // window — otherwise the dialog's own countdown would force a logout the
  // keepalive had just averted.
  const lastApiCallAt = useAuthStore((s) => s.lastApiCallAt)
  useEffect(() => {
    if (!showExpiryWarning || !lastApiCallAt) return
    const elapsed = Date.now() - lastApiCallAt
    if (elapsed < SESSION_TIMEOUT_MS - WARNING_BEFORE_MS) {
      setShowExpiryWarning(false)
    }
  }, [lastApiCallAt, showExpiryWarning])

  // Explicit sign-out (from the warning dialog's "Log out now"): revoke the
  // token server-side and fan out to other tabs.
  function handleLogout() {
    setShowExpiryWarning(false)
    useAuthStore.getState().logout({ broadcast: true, revoke: true })
    navigate('/login', { replace: true })
  }

  // Derive display data
  const items = isSearching ? (searchResponse?.data ?? []) : (childrenResponse?.data ?? [])
  const breadcrumbs = childrenResponse?.path ?? []
  const folderName = currentFolderName ?? ''
  // Show the content skeleton during the cold-start window too: before a
  // database is auto-selected the children query is disabled (isLoading=false),
  // which otherwise renders a misleading "No entries" empty state.
  const contentLoading =
    loadingDbs || (!currentDatabaseId && databases.length > 0) || loadingChildren
  const selectedCompactEntry = selectedEntryId
    ? (items.filter(isEntry).find((e) => e.id === selectedEntryId) as EntryCompact | undefined)
    : undefined

  return (
    <>
      <VaultShell
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        sidebar={
          loadingDbs ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : (
            <FolderTree
              dbId={currentDatabaseId}
              dbName={currentDb?.name}
              activeFolderId={currentFolderId}
              onFolderClick={handleFolderClick}
              recycleBinOpen={recycleBinOpen}
              onRecycleBinClick={handleRecycleBinClick}
            />
          )
        }
        content={
          <div className="p-4">
            {/* Three views share this pane. A search wins over both of the
                others, as it already wins over the folder being browsed: it is
                typed with the bin open too, and results the user cannot see
                would be no answer at all. Clearing it returns to whichever of
                the two is still current. */}
            {isSearching ? (
              searchIsError ? (
                <ContentError
                  message={t('errors.searchFailed')}
                  retryLabel={t('common.retry')}
                />
              ) : (
                <SearchResults
                  query={searchQuery}
                  items={items}
                  isLoading={loadingSearch}
                  selectedEntryId={selectedEntryId}
                  onFolderClick={handleFolderClick}
                  onEntryClick={selectEntry}
                />
              )
            ) : recycleBinOpen && currentDatabaseId ? (
              <RecycleBinView dbId={currentDatabaseId} />
            ) : (
              <>
                {/* Breadcrumbs + Toolbar */}
                {currentDatabaseId && (
                  <div className="mb-4 flex items-center justify-between">
                    <Breadcrumbs
                      path={breadcrumbs}
                      currentName={currentFolderId ? folderName : undefined}
                      onNavigate={handleFolderClick}
                    />
                    <CreateMenu
                      onNewFolder={newFolderDialog.open}
                      onNewEntry={(type) => { setNewEntryType(type); newEntryDialog.open() }}
                      onNewDocument={() => fileInputRef.current?.click()}
                    />
                  </div>
                )}

                {dbError && !loadingDbs ? (
                  <ContentError
                    message={t('errors.loadDatabases')}
                    retryLabel={t('common.retry')}
                    onRetry={() => refetchDatabases()}
                  />
                ) : childrenIsError ? (
                  <ContentError
                    message={describeApiError(childrenError, t)}
                    retryLabel={t('common.retry')}
                    onRetry={() => refetchChildren()}
                  />
                ) : contentLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    {childrenResponse?.truncated && (
                      <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {t('vault.truncatedNotice', { count: items.length })}
                      </div>
                    )}
                    <EntryList
                      items={items}
                      selectedEntryId={selectedEntryId}
                      onFolderClick={handleFolderClick}
                      onEntryClick={selectEntry}
                    />
                  </>
                )}
              </>
            )}
          </div>
        }
        detail={
          selectedEntryId && currentDatabaseId ? (
            <EntryDetail
              key={selectedEntryId}
              dbId={currentDatabaseId}
              compactEntry={selectedCompactEntry}
              onEdit={editEntryDialog.open}
              onMove={moveEntryDialog.open}
              onDelete={() => setShowDeleteEntry(true)}
            />
          ) : undefined
        }
        infoPanel={
          <InfoPanel
            mode={isSearching ? 'search' : currentDatabaseId ? 'folder' : 'empty'}
            folderName={folderName}
            databaseName={currentDb?.name}
            itemCount={items.length}
            searchQuery={isSearching ? searchQuery : undefined}
            isRoot={!currentFolderId}
            onEdit={currentFolderId ? editFolderDialog.open : undefined}
            onMove={currentFolderId ? moveFolderDialog.open : undefined}
            onDelete={currentFolderId ? deleteFolderDialog.open : undefined}
          />
        }
        detailOpen={!!selectedEntryId}
        onDetailClose={() => selectEntry(null)}
        statusBar={<StatusBar itemCount={items.length} folderName={folderName || currentDb?.name || ''} />}
      />

      {/* New Entry dialog — conditionally mounted so each open starts with
          fresh form state (no stale prefilled values from the previous one). */}
      {newEntryDialog.isOpen && (
        <EntryFormDialog
          open
          onClose={newEntryDialog.close}
          defaultType={newEntryType}
          dbId={currentDatabaseId}
          onSubmit={async (data) => { await createEntryMut.mutateAsync(data) }}
          isSubmitting={createEntryMut.isPending}
        />
      )}

      {/* Hidden file input for document upload */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleDocumentUpload}
      />

      {/* Edit Entry dialog */}
      {editEntryDialog.isOpen && editingEntry && (
        <EntryFormDialog
          open={editEntryDialog.isOpen}
          onClose={editEntryDialog.close}
          entry={editingEntry}
          dbId={currentDatabaseId}
          onSubmit={async (data) => {
            await updateEntryMut.mutateAsync({ entryId: selectedEntryId!, data, secondPassword: selectedSecondPassword })
          }}
          isSubmitting={updateEntryMut.isPending}
        />
      )}

      {/* Delete Entry confirm */}
      <ConfirmDialog
        open={showDeleteEntry}
        onClose={() => setShowDeleteEntry(false)}
        onConfirm={() => selectedEntryId && deleteEntryMut.mutate(selectedEntryId)}
        title={t('confirm.deleteEntryTitle')}
        description={
          currentDb?.recycle_bin?.enabled
            ? t('confirm.deleteEntryDescBin')
            : t('confirm.deleteEntryDesc')
        }
        destructive
      />

      {/* New Folder dialog — conditionally mounted so each open starts with
          a fresh, empty name field. */}
      {newFolderDialog.isOpen && (
        <FolderFormDialog
          open
          onClose={newFolderDialog.close}
          onSubmit={async (data) => { await createFolderMut.mutateAsync(data) }}
          isSubmitting={createFolderMut.isPending}
        />
      )}

      {/* Move Entry picker */}
      {moveEntryDialog.isOpen && currentDatabaseId && selectedEntryId && (
        <FolderPicker
          open={moveEntryDialog.isOpen}
          onClose={moveEntryDialog.close}
          dbId={currentDatabaseId}
          onSelect={(folderId) => {
            moveEntryMut.mutate({ entryId: selectedEntryId, data: { target: folderId } })
            moveEntryDialog.close()
          }}
          title={t('folderPicker.moveEntryTitle')}
        />
      )}

      {/* Rename Folder dialog — operates on the currently navigated folder. */}
      {editFolderDialog.isOpen && currentFolderId && (
        <FolderFormDialog
          open
          onClose={editFolderDialog.close}
          initialName={folderName}
          onSubmit={async (data) => {
            await updateFolderMut.mutateAsync({ folderId: currentFolderId, data })
            // Keep the locally-cached folder name in sync so the InfoPanel /
            // breadcrumb reflect the new name immediately, without waiting
            // for the next navigation.
            setFolder(currentFolderId, data.name)
          }}
          isSubmitting={updateFolderMut.isPending}
        />
      )}

      {/* Move Folder picker — destination cannot be the folder itself. */}
      {moveFolderDialog.isOpen && currentDatabaseId && currentFolderId && (
        <FolderPicker
          open
          onClose={moveFolderDialog.close}
          dbId={currentDatabaseId}
          excludeIds={[currentFolderId]}
          onSelect={(targetFolderId) => {
            moveFolderMut.mutate({ folderId: currentFolderId, data: { target: targetFolderId } })
            moveFolderDialog.close()
          }}
          title={t('folderPicker.moveFolderTitle')}
        />
      )}

      {/* Delete Folder confirm */}
      <ConfirmDialog
        open={deleteFolderDialog.isOpen}
        onClose={deleteFolderDialog.close}
        onConfirm={() => currentFolderId && deleteFolderMut.mutate(currentFolderId)}
        title={t('confirm.deleteFolderTitle')}
        description={
          currentDb?.recycle_bin?.enabled
            ? t('confirm.deleteFolderDescBin')
            : t('confirm.deleteFolderDesc')
        }
        destructive
      />

      <SessionExpiryWarning
        open={showExpiryWarning}
        onStayLoggedIn={() => setShowExpiryWarning(false)}
        onLogout={handleLogout}
      />

      {uploadState && (
        <UploadProgressDialog
          open
          fileName={uploadState.fileName}
          progress={uploadState.progress}
          onCancel={handleUploadCancel}
        />
      )}
    </>
  )
}
