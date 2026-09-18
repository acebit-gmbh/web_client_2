import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TreeNode } from './TreeNode'
import { getDatabaseIcon, getDatabaseIcons } from '@/api/icons'
import { getChildren } from '@/api/folders'
import { dbIconBatcher } from '@/lib/dbIcons'
import { useNavigationStore } from '@/stores/navigationStore'
import type { FolderCompact } from '@/api/types'
import {
  ICON_CAPABILITY,
  PNG_DATA_URL,
  database,
  databasesResponse,
  iconsResponse,
  okIcon,
} from '@/test/iconFixtures'

vi.mock('@/api/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/icons')>()),
  getDatabaseIcons: vi.fn(),
  getDatabaseIcon: vi.fn(),
}))
vi.mock('@/api/folders', () => ({ getChildren: vi.fn() }))

const getDatabaseIconsMock = vi.mocked(getDatabaseIcons)
const getDatabaseIconMock = vi.mocked(getDatabaseIcon)
const getChildrenMock = vi.mocked(getChildren)

function folder(extra: Partial<FolderCompact> = {}): FolderCompact {
  return {
    type: 'folder',
    id: 'f1',
    name: 'Projects',
    has_second_pass: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

let queryClient: QueryClient

function renderNode(item: FolderCompact) {
  const tree = (next: FolderCompact) => (
    <QueryClientProvider client={queryClient}>
      <TreeNode folder={next} dbId="db" activeFolderId={null} depth={1} onFolderClick={() => {}} />
    </QueryClientProvider>
  )
  const view = render(tree(item))
  return {
    ...view,
    rerenderNode: (next: FolderCompact) => view.rerender(tree(next)),
    img: () => view.container.querySelector('img'),
    glyph: () => view.container.querySelector('svg.lucide-folder, svg.lucide-folder-open'),
  }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  dbIconBatcher.reset()
  getDatabaseIconsMock.mockReset()
  getDatabaseIconMock.mockReset()
  getChildrenMock.mockReset()
  getDatabaseIconsMock.mockImplementation(async (_dbId, ids) =>
    iconsResponse(...ids.map((id) => okIcon(id))),
  )
  queryClient = new QueryClient()
  queryClient.setQueryData(['databases'], databasesResponse(database('db', ICON_CAPABILITY)))
  // The tree gets its database as a prop; the store deliberately says something else.
  useNavigationStore.getState().setDatabase('not-this-one')
})

describe('TreeNode folder icon', () => {
  it('shows the bundled standard icon and mounts no image hook for a plain folder', async () => {
    const view = renderNode(folder({ icon: 'ico3.svg', database_icon: null }))
    await settle()
    expect(view.img()?.getAttribute('src')).toBe('/icons/ico3.svg')
    expect(queryClient.getQueryCache().findAll({ queryKey: ['db-icon'] })).toHaveLength(0)
    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: ['databases'] })
        ?.getObserversCount(),
    ).toBe(0)
    expect(getDatabaseIconsMock).not.toHaveBeenCalled()
  })

  it('keeps the Folder glyph as the last fallback', () => {
    const view = renderNode(folder())
    expect(view.img()).toBeNull()
    expect(view.glyph()).not.toBeNull()
  })

  it('does not stay on the glyph for good after one image failed (sticky-failure fix)', () => {
    const view = renderNode(folder({ icon: 'legacy-a.ico' }))
    expect(view.img()?.getAttribute('src')).toBe('/file/legacy-a.ico')

    fireEvent.error(view.img()!)
    expect(view.img()).toBeNull()
    expect(view.glyph()).not.toBeNull()

    // The folder's icon changes: the same component instance must try the new image.
    view.rerenderNode(folder({ icon: 'ico5.svg' }))
    expect(view.img()?.getAttribute('src')).toBe('/icons/ico5.svg')

    // ...and the image that failed still counts as failed when it comes back.
    view.rerenderNode(folder({ icon: 'legacy-a.ico' }))
    expect(view.img()).toBeNull()
  })

  it('shows the database icon of the tree database, standard icon while loading', async () => {
    const view = renderNode(
      folder({ icon: 'ico3.svg', database_icon: { id: '7', name: 'team', version: 'v7' } }),
    )
    expect(view.img()?.getAttribute('src')).toBe('/icons/ico3.svg')

    await waitFor(() => expect(view.img()?.getAttribute('src')).toBe(PNG_DATA_URL))
    expect(view.img()?.className).toContain('h-4 w-4')
    expect(getDatabaseIconsMock).toHaveBeenCalledWith('db', ['7'])
  })

  it('walks the chain: database icon -> standard icon -> Folder glyph', async () => {
    const view = renderNode(
      folder({ icon: 'ico3.svg', database_icon: { id: '7', name: 'team', version: 'v7' } }),
    )
    await waitFor(() => expect(view.img()?.getAttribute('src')).toBe(PNG_DATA_URL))

    fireEvent.error(view.img()!)
    expect(view.img()?.getAttribute('src')).toBe('/icons/ico3.svg')

    fireEvent.error(view.img()!)
    expect(view.img()).toBeNull()
    expect(view.glyph()).not.toBeNull()
  })

  it('falls back to the standard icon for an unusable database icon', async () => {
    getDatabaseIconsMock.mockResolvedValue(
      iconsResponse({ id: '7', name: 'team', version: 'v7', state: 'unusable' }),
    )
    const view = renderNode(
      folder({ icon: 'ico3.svg', database_icon: { id: '7', name: 'team', version: 'v7' } }),
    )
    await waitFor(() => expect(getDatabaseIconsMock).toHaveBeenCalled())
    await settle()
    expect(view.img()?.getAttribute('src')).toBe('/icons/ico3.svg')
  })
})
