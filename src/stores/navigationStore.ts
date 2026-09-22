import { create } from 'zustand'

interface NavigationState {
  currentDatabaseId: string | null
  currentFolderId: string | null
  currentFolderName: string | null
  selectedEntryId: string | null
  /**
   * Whether the content pane shows the database's recycle bin instead of a
   * folder. Like `isSearching` in VaultPage this is a view mode, not a place:
   * there is no URL for it, and every navigation clears it - setFolder and
   * setDatabase below, so no caller has to remember to.
   */
  recycleBinOpen: boolean

  setDatabase: (dbId: string) => void
  setFolder: (folderId: string | null, folderName?: string | null) => void
  selectEntry: (entryId: string | null) => void
  openRecycleBin: () => void
  reset: () => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  currentDatabaseId: null,
  currentFolderId: null,
  currentFolderName: null,
  selectedEntryId: null,
  recycleBinOpen: false,

  setDatabase: (dbId) =>
    set({
      currentDatabaseId: dbId,
      currentFolderId: null,
      currentFolderName: null,
      selectedEntryId: null,
      recycleBinOpen: false,
    }),

  setFolder: (folderId, folderName) =>
    set({
      currentFolderId: folderId,
      currentFolderName: folderName ?? null,
      selectedEntryId: null,
      recycleBinOpen: false,
    }),

  selectEntry: (entryId) => set({ selectedEntryId: entryId }),

  // Leaves the entry selection alone on purpose: the detail panel of an entry
  // that is still in the tree may stay open beside the bin.
  openRecycleBin: () => set({ recycleBinOpen: true }),

  reset: () =>
    set({
      currentDatabaseId: null,
      currentFolderId: null,
      currentFolderName: null,
      selectedEntryId: null,
      recycleBinOpen: false,
    }),
}))
