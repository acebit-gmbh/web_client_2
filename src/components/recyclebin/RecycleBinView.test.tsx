import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { RecycleBinView } from './RecycleBinView'
import {
  listRecycleBin,
  restoreRecycleBinItem,
  purgeRecycleBinItem,
  emptyRecycleBin,
  type RecycleBinItem,
} from '@/api/recyclebin'
import { getUser } from '@/api/users'
import { ApiError } from '@/api/client'
import { useToastStore } from '@/stores/toastStore'
import type { DatabaseCompact, DatabaseRecycleBinCapability } from '@/api/types'

vi.mock('@/api/recyclebin', () => ({
  listRecycleBin: vi.fn(),
  restoreRecycleBinItem: vi.fn(),
  purgeRecycleBinItem: vi.fn(),
  emptyRecycleBin: vi.fn(),
}))
vi.mock('@/api/users', () => ({ getUser: vi.fn() }))

const listMock = vi.mocked(listRecycleBin)
const restoreMock = vi.mocked(restoreRecycleBinItem)
const purgeMock = vi.mocked(purgeRecycleBinItem)
const emptyMock = vi.mocked(emptyRecycleBin)
const getUserMock = vi.mocked(getUser)

const ME = 'user-me-guid'
const OTHER = 'user-other-guid'

function item(id: string, extra: Partial<RecycleBinItem> = {}): RecycleBinItem {
  return {
    type: 'password',
    id,
    name: `Entry ${id}`,
    has_second_pass: false,
    icon: 'ico0.svg',
    updated_at: '2026-01-01T00:00:00Z',
    database_icon: null,
    deleted_by: ME,
    ...extra,
  } as RecycleBinItem
}

function page(items: RecycleBinItem[], total = items.length, offset = 0) {
  return { data: items, total, offset, limit: 100 }
}

function db(recycleBin: DatabaseRecycleBinCapability | undefined): DatabaseCompact {
  return {
    id: 'db',
    name: 'Database db',
    description: '',
    updated_at: '2026-01-01T00:00:00Z',
    ...(recycleBin ? { recycle_bin: recycleBin } : {}),
  }
}

const MANAGER: DatabaseRecycleBinCapability = { enabled: true, keep: 100, can_manage: true }
const OWN_ONLY: DatabaseRecycleBinCapability = { enabled: true, keep: 100, can_manage: false }

let queryClient: QueryClient

function renderBin(capability: DatabaseRecycleBinCapability | null = MANAGER) {
  queryClient.setQueryData(['databases'], {
    data: [db(capability ?? undefined)],
    total: 1,
    offset: 0,
    limit: 200,
  })
  queryClient.setQueryData(['profile'], { id: ME, name: 'me' })
  return render(
    <QueryClientProvider client={queryClient}>
      <RecycleBinView dbId="db" />
    </QueryClientProvider>,
  )
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.getState().clear()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  listMock.mockResolvedValue(page([item('a'), item('b')]))
  restoreMock.mockResolvedValue(undefined)
  purgeMock.mockResolvedValue(undefined)
  emptyMock.mockResolvedValue(undefined)
  getUserMock.mockResolvedValue({ id: OTHER, name: 'jdoe', display_name: 'Jane Doe' })
})

describe('RecycleBinView', () => {
  it('lists what the bin holds and offers both actions on every row', async () => {
    renderBin()

    expect(await screen.findByText('Entry a')).toBeInTheDocument()
    expect(screen.getByText('Entry b')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Entry a' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Entry a for good' })).toBeInTheDocument()
    // Both are offered on every row: restore and delete-for-good rest on
    // different rights, so neither can be ruled out from the listing alone.
    expect(screen.getByRole('button', { name: 'Restore Entry b' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Entry b for good' })).toBeInTheDocument()
  })

  it('names the limit the server silently enforces', async () => {
    renderBin()

    // The oldest rows are dropped once the bin passes recycle_bin.keep, with no
    // notice of any kind, so the number is on screen beside the count.
    expect(await screen.findByText(/keeps up to 100/)).toBeInTheDocument()
  })

  it('shows the empty state, and no way to empty an already empty bin', async () => {
    listMock.mockResolvedValue(page([]))
    renderBin()

    expect(await screen.findByText('The recycle bin is empty')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Empty recycle bin' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('recycle-bin-list')).not.toBeInTheDocument()
  })

  it('offers a retry when the bin cannot be read', async () => {
    listMock.mockRejectedValue(new ApiError(500, 500, 'boom'))
    renderBin()

    expect(await screen.findByText('The recycle bin could not be loaded.')).toBeInTheDocument()
    listMock.mockResolvedValue(page([item('a')]))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Entry a')).toBeInTheDocument()
  })

  it('restores without asking, and marks the listings the item returns to as stale', async () => {
    renderBin()
    await screen.findByText('Entry a')

    await userEvent.click(screen.getByRole('button', { name: 'Restore Entry a' }))

    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith('db', 'a'))
    // It is back in the tree, so the bin is re-read rather than edited locally;
    // nothing here decides where it landed.
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(useToastStore.getState().toasts[0]?.message).toBe('Item restored')
  })

  it('reports a refused restore instead of pretending the item came back', async () => {
    restoreMock.mockRejectedValue(new ApiError(403, 4031, 'Access denied'))
    renderBin()
    await screen.findByText('Entry a')

    await userEvent.click(screen.getByRole('button', { name: 'Restore Entry a' }))

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    const toast = useToastStore.getState().toasts[0]
    expect(toast.variant).toBe('error')
    expect(toast.title).toBe('Item could not be restored')
    // The row stays: a refusal changes nothing about what the bin holds.
    expect(screen.getByText('Entry a')).toBeInTheDocument()
  })

  it('asks before deleting for good, and asks nothing of the server when dismissed', async () => {
    renderBin()
    await screen.findByText('Entry a')

    await userEvent.click(screen.getByRole('button', { name: 'Delete Entry a for good' }))
    expect(await screen.findByText('Delete for good?')).toBeInTheDocument()
    expect(screen.getByText('"Entry a" will be deleted for good. This cannot be undone.')).toBeInTheDocument()
    expect(purgeMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await settle()
    expect(purgeMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete Entry a for good' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(purgeMock).toHaveBeenCalledWith('db', 'a'))
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('empties on confirmation and then shows what the server kept', async () => {
    renderBin()
    await screen.findByText('Entry a')

    await userEvent.click(screen.getByRole('button', { name: 'Empty recycle bin' }))
    expect(await screen.findByText('Empty the recycle bin?')).toBeInTheDocument()
    expect(emptyMock).not.toHaveBeenCalled()

    // What the caller may not delete stays behind, and the call still succeeds.
    listMock.mockResolvedValue(page([item('b')]))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Empty recycle bin' }))

    await waitFor(() => expect(emptyMock).toHaveBeenCalledWith('db'))
    // The listing is re-read rather than emptied locally, so the row the server
    // refused to destroy is still on screen afterwards.
    await waitFor(() => expect(screen.queryByText('Entry a')).not.toBeInTheDocument())
    expect(screen.getByText('Entry b')).toBeInTheDocument()
    expect(screen.queryByText('The recycle bin is empty')).not.toBeInTheDocument()
    // ... and the message says so, rather than reporting an empty bin over it.
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    expect(useToastStore.getState().toasts[0].message).toBe(
      'Items you may not delete are still in the recycle bin',
    )
  })

  it('reports an emptied bin only when the bin really is empty', async () => {
    renderBin()
    await screen.findByText('Entry a')

    listMock.mockResolvedValue(page([]))
    await userEvent.click(screen.getByRole('button', { name: 'Empty recycle bin' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Empty recycle bin' }))

    expect(await screen.findByText('The recycle bin is empty')).toBeInTheDocument()
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1))
    expect(useToastStore.getState().toasts[0].message).toBe('Recycle bin emptied')
  })

  it('names who deleted an item, and never shows the id it is given as', async () => {
    listMock.mockResolvedValue(page([item('a', { deleted_by: OTHER })]))
    const { container } = renderBin()

    expect(await screen.findByText(/deleted by Jane Doe/)).toBeInTheDocument()
    expect(getUserMock).toHaveBeenCalledWith(OTHER)
    expect(container.textContent).not.toContain(OTHER)
  })

  it('says nothing about a deleter it cannot name', async () => {
    getUserMock.mockRejectedValue(new ApiError(404, 4041, 'User not found'))
    listMock.mockResolvedValue(page([item('a', { deleted_by: OTHER })]))
    const { container } = renderBin()

    await screen.findByText('Entry a')
    await settle()
    expect(container.textContent).not.toContain('deleted by')
    expect(container.textContent).not.toContain(OTHER)
  })

  it('marks own deletions without asking the server who that is', async () => {
    renderBin()

    expect(await screen.findAllByText(/deleted by you/)).toHaveLength(2)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('says nothing about deleters where only own items can appear', async () => {
    listMock.mockResolvedValue(page([item('a', { deleted_by: ME })]))
    const { container } = renderBin(OWN_ONLY)

    await screen.findByText('Entry a')
    await settle()
    // can_manage false: every row would carry the same attribution.
    expect(container.textContent).not.toContain('deleted by')
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('asks for the whole bin in one go, with no page to click through', async () => {
    renderBin()
    await screen.findByText('Entry a')

    // listRecycleBin pages to the end itself, like every other listing here.
    expect(listMock).toHaveBeenCalledWith('db')
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument()
  })

  it('says when it could not show the whole bin', async () => {
    listMock.mockResolvedValue({ ...page([item('a'), item('b')], 9000), truncated: true })
    renderBin()

    // The client ceiling, not the server's: what is on screen is a prefix, and
    // the bin cannot be searched, so the notice must not send anyone there.
    expect(
      await screen.findByText('Showing the first 2 items of the recycle bin.'),
    ).toBeInTheDocument()
  })

  it('asks the server nothing where the database keeps no bin', async () => {
    renderBin(null)
    await settle()

    expect(listMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recycle-bin-list')).not.toBeInTheDocument()
  })
})
