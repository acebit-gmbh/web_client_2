import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { FolderTree } from './FolderTree'
import { getChildren } from '@/api/folders'
import type { DatabaseCompact, DatabaseRecycleBinCapability } from '@/api/types'

vi.mock('@/api/folders', () => ({ getChildren: vi.fn() }))

const getChildrenMock = vi.mocked(getChildren)

const BIN: DatabaseRecycleBinCapability = { enabled: true, keep: 100, can_manage: false }
const NO_BIN: DatabaseRecycleBinCapability = { enabled: false, keep: 0, can_manage: false }

function db(recycleBin?: DatabaseRecycleBinCapability): DatabaseCompact {
  return {
    id: 'db',
    name: 'Database db',
    description: '',
    updated_at: '2026-01-01T00:00:00Z',
    ...(recycleBin ? { recycle_bin: recycleBin } : {}),
  }
}

let queryClient: QueryClient

function renderTree(recycleBin?: DatabaseRecycleBinCapability, onRecycleBinClick = vi.fn()) {
  queryClient.setQueryData(['databases'], {
    data: [db(recycleBin)],
    total: 1,
    offset: 0,
    limit: 200,
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FolderTree
        dbId="db"
        dbName="Database db"
        activeFolderId={null}
        onFolderClick={() => {}}
        recycleBinOpen={false}
        onRecycleBinClick={onRecycleBinClick}
      />
    </QueryClientProvider>,
  )
  return { ...view, onRecycleBinClick }
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  getChildrenMock.mockResolvedValue({ path: [], data: [], total: 0, offset: 0, limit: 100 })
})

describe('FolderTree recycle bin item', () => {
  it('offers the bin where the server keeps one', async () => {
    const { onRecycleBinClick } = renderTree(BIN)

    const item = await screen.findByRole('button', { name: 'Recycle bin' })
    await userEvent.click(item)
    expect(onRecycleBinClick).toHaveBeenCalledTimes(1)
  })

  it('leaves it out where the server keeps no bin', async () => {
    renderTree(NO_BIN)

    // Wait for the tree itself: by then the item would have rendered if the
    // capability had allowed it. Asserting before that proves nothing.
    await screen.findByRole('tree')
    expect(screen.queryByRole('button', { name: 'Recycle bin' })).not.toBeInTheDocument()
  })

  it('leaves it out where the database carries no capability at all', async () => {
    // An older server sends no recycle_bin object. This is a render of its
    // own: changing the cached databases response under a mounted tree does
    // not repaint it within the same tick, and an assertion there would pass
    // whatever the component does.
    renderTree(undefined)

    await screen.findByRole('tree')
    expect(screen.queryByRole('button', { name: 'Recycle bin' })).not.toBeInTheDocument()
  })

  it('keeps the bin out of the folder tree itself', async () => {
    renderTree(BIN)

    const item = await screen.findByRole('button', { name: 'Recycle bin' })
    // It is not a folder: it must not be a treeitem, must not take part in the
    // tree's roving tab stop, and must not sit inside the tree at all.
    expect(item).not.toHaveAttribute('role', 'treeitem')
    const tree = await screen.findByRole('tree')
    expect(within(tree).queryByRole('button', { name: 'Recycle bin' })).not.toBeInTheDocument()
    expect(tree.contains(item)).toBe(false)
  })

  it('shows which view is current', async () => {
    renderTree(BIN)
    expect(await screen.findByRole('button', { name: 'Recycle bin' })).not.toHaveAttribute(
      'aria-current',
    )

    queryClient.setQueryData(['databases'], { data: [db(BIN)], total: 1, offset: 0, limit: 200 })
    render(
      <QueryClientProvider client={queryClient}>
        <FolderTree
          dbId="db"
          dbName="Database db"
          activeFolderId={null}
          onFolderClick={() => {}}
          recycleBinOpen
          onRecycleBinClick={() => {}}
        />
      </QueryClientProvider>,
    )

    const open = await screen.findAllByRole('button', { name: 'Recycle bin' })
    expect(open[1]).toHaveAttribute('aria-current', 'true')
  })
})
