import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '@/i18n'
import VaultPage from './VaultPage'
import { createEntry } from '@/api/entries'
import { useNavigationStore } from '@/stores/navigationStore'
import type { CreateEntryRequest, EntryCompact } from '@/api/types'

const state = vi.hoisted(() => ({
  items: [] as EntryCompact[],
  appBar: null as { searchQuery: string; onSearchChange: (query: string) => void } | null,
}))
vi.mock('@/api/entries', async (original) => ({
  ...(await original<typeof import('@/api/entries')>()),
  createEntry: vi.fn(),
}))
vi.mock('@/hooks/useVaultAppBar', () => ({
  useVaultAppBar: (props: typeof state.appBar) => {
    state.appBar = props
  },
}))
vi.mock('@/hooks/useDatabases', () => ({
  useDatabases: () => ({ data: { data: [{ id: 'db', name: 'Database' }] }, isLoading: false }),
}))
vi.mock('@/hooks/useChildren', () => ({
  useChildren: () => ({
    data: { data: state.items, path: [], total: state.items.length },
    isLoading: false,
  }),
}))
vi.mock('@/hooks/useSearch', () => ({
  useSearch: () => ({ data: { data: [] }, isLoading: false }),
}))
vi.mock('@/hooks/useSessionWatchdog', () => ({ useSessionWatchdog: vi.fn() }))
vi.mock('@/hooks/useAutoLock', () => ({ useAutoLock: vi.fn() }))
vi.mock('@/components/layout/VaultShell', () => ({
  VaultShell: ({ content, detail }: { content: React.ReactNode; detail: React.ReactNode }) => (
    <>
      {content}
      {detail}
    </>
  ),
}))
vi.mock('@/components/tree/FolderTree', () => ({ FolderTree: () => null }))
vi.mock('@/components/entries/InfoPanel', () => ({ InfoPanel: () => null }))
vi.mock('@/components/entries/EntryList', () => ({ EntryList: () => <div>Folder list</div> }))
vi.mock('@/components/search/SearchResults', () => ({
  SearchResults: () => <div>Filtered search</div>,
}))
vi.mock('@/components/entries/EntryDetail', () => ({
  EntryDetail: ({ compactEntry }: { compactEntry?: EntryCompact }) => (
    <div data-testid="selected-detail">{compactEntry?.name ?? 'No selected item in this view'}</div>
  ),
}))
vi.mock('@/components/common/CreateMenu', () => ({
  CreateMenu: ({ onNewEntry }: { onNewEntry: (type: 'certificate') => void }) => (
    <button onClick={() => onNewEntry('certificate')}>New certificate</button>
  ),
}))
vi.mock('@/components/entries/EntryFormDialog', () => ({
  EntryFormDialog: ({
    onSubmit,
    onClose,
  }: {
    onSubmit: (value: CreateEntryRequest) => Promise<void>
    onClose: () => void
  }) => (
    <button
      onClick={async () => {
        await onSubmit({ type: 'certificate', name: 'Created certificate' })
        onClose()
      }}
    >
      Save certificate
    </button>
  ),
}))

let queryClient: QueryClient
const created: EntryCompact = {
  id: 'created',
  type: 'certificate',
  name: 'Created certificate',
  has_second_pass: false,
  has_otp: false,
  updated_at: '2026-09-25T00:00:00Z',
}
beforeEach(() => {
  state.items = []
  state.appBar = null
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useNavigationStore.getState().setDatabase('db')
  useNavigationStore.getState().setFolder('original-folder', 'Original folder')
  vi.mocked(createEntry).mockReset()
})
afterEach(() => queryClient.clear())

it.each(['unchanged', 'folder', 'selection'] as const)(
  'reveals a created certificate by clearing search only while still in its creation context (navigated: %s)',
  async (navigated) => {
    let complete!: (entry: EntryCompact) => void
    vi.mocked(createEntry).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <VaultPage />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'New certificate' }))
    // The header can change search while creation is open or awaiting its response.
    act(() => state.appBar?.onSearchChange('does-not-match'))
    fireEvent.click(screen.getByRole('button', { name: 'Save certificate' }))
    await waitFor(() =>
      expect(createEntry).toHaveBeenCalledWith(
        'db',
        { type: 'certificate', name: 'Created certificate' },
        'original-folder',
      ),
    )
    if (navigated !== 'unchanged') {
      act(() => {
        if (navigated === 'folder')
          useNavigationStore.getState().setFolder('newer-folder', 'Newer folder')
        useNavigationStore.getState().selectEntry('unrelated-selection')
      })
    }
    state.items = [created]
    await act(async () => complete(created))
    if (navigated !== 'unchanged') {
      expect(useNavigationStore.getState().currentFolderId).toBe(
        navigated === 'folder' ? 'newer-folder' : 'original-folder',
      )
      expect(useNavigationStore.getState().selectedEntryId).toBe('unrelated-selection')
      expect(state.appBar?.searchQuery).toBe('does-not-match')
    } else {
      expect(state.appBar?.searchQuery).toBe('')
      expect(useNavigationStore.getState().currentFolderId).toBe('original-folder')
      expect(useNavigationStore.getState().selectedEntryId).toBe('created')
      expect(screen.getByTestId('selected-detail')).toHaveTextContent('Created certificate')
    }
  },
)
