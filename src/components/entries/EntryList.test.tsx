import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryList } from './EntryList'
import { EntryDetail } from './EntryDetail'
import { getDatabaseIcon, getDatabaseIcons } from '@/api/icons'
import { getEntry } from '@/api/entries'
import { dbIconBatcher } from '@/lib/dbIcons'
import { useNavigationStore } from '@/stores/navigationStore'
import type { CompactItem, EntryCompact, FolderCompact } from '@/api/types'
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
vi.mock('@/api/entries', () => ({ getEntry: vi.fn(), getEntryOtp: vi.fn() }))

const getDatabaseIconsMock = vi.mocked(getDatabaseIcons)
const getDatabaseIconMock = vi.mocked(getDatabaseIcon)
const getEntryMock = vi.mocked(getEntry)

function entry(id: string, extra: Partial<EntryCompact> = {}): EntryCompact {
  return {
    type: 'password',
    id,
    name: `Entry ${id}`,
    has_second_pass: false,
    icon: 'ico0.svg',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

function folder(id: string, extra: Partial<FolderCompact> = {}): FolderCompact {
  return {
    type: 'folder',
    id,
    name: `Folder ${id}`,
    has_second_pass: false,
    icon: 'ico3.svg',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

let queryClient: QueryClient

function renderList(items: CompactItem[]) {
  return render(
    <QueryClientProvider client={queryClient}>
      <EntryList
        items={items}
        selectedEntryId={null}
        onFolderClick={() => {}}
        onEntryClick={() => {}}
      />
    </QueryClientProvider>,
  )
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const iconQueries = () => queryClient.getQueryCache().findAll({ queryKey: ['db-icon'] })
const databasesObservers = () =>
  queryClient
    .getQueryCache()
    .find({ queryKey: ['databases'] })
    ?.getObserversCount() ?? 0
const sources = (container: HTMLElement) =>
  [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))

beforeEach(() => {
  dbIconBatcher.reset()
  getDatabaseIconsMock.mockReset()
  getDatabaseIconMock.mockReset()
  getEntryMock.mockReset()
  getDatabaseIconsMock.mockImplementation(async (_dbId, ids) =>
    iconsResponse(...ids.map((id) => okIcon(id))),
  )
  queryClient = new QueryClient()
  queryClient.setQueryData(['databases'], databasesResponse(database('db', ICON_CAPABILITY)))
  useNavigationStore.getState().setDatabase('db')
})

describe('EntryList icons', () => {
  it('mounts no image hook and asks the server nothing for rows without a database icon', async () => {
    const items: CompactItem[] = [
      folder('f1', { database_icon: null }),
      ...Array.from({ length: 50 }, (_, i) => entry(`e${i}`, { database_icon: null })),
      // An older server does not send the key at all.
      entry('legacy'),
    ]
    const { container } = renderList(items)
    await settle()

    expect(container.querySelectorAll('img')).toHaveLength(52)
    expect(iconQueries()).toHaveLength(0)
    expect(databasesObservers()).toBe(0)
    expect(getDatabaseIconsMock).not.toHaveBeenCalled()
  })

  it('loads every database icon of the listing with ONE request, entries and folders alike', async () => {
    const items: CompactItem[] = [
      folder('f1', { database_icon: { id: '7', name: 'team', version: 'v7' } }),
      entry('e1', { database_icon: { id: '3', name: 'example.com', version: 'v3' } }),
      entry('e2', { database_icon: null }),
      // Two rows share an icon: one query, one id in the request.
      entry('e3', { database_icon: { id: '3', name: 'example.com', version: 'v3' } }),
      entry('e4', { database_icon: { id: '12', name: 'bank', version: 'v12' } }),
    ]
    const { container } = renderList(items)

    // Standard icons first, so nothing shifts when the images arrive.
    expect(sources(container).every((src) => src?.startsWith('/icons/'))).toBe(true)

    await waitFor(() =>
      expect(sources(container).filter((src) => src === PNG_DATA_URL)).toHaveLength(4),
    )
    expect(sources(container).filter((src) => src === '/icons/ico0.svg')).toHaveLength(1)

    expect(getDatabaseIconsMock).toHaveBeenCalledTimes(1)
    const [dbId, ids] = getDatabaseIconsMock.mock.calls[0]
    expect(dbId).toBe('db')
    expect([...ids].sort()).toEqual(['12', '3', '7'])
    expect(getDatabaseIconMock).not.toHaveBeenCalled()

    expect(iconQueries()).toHaveLength(3)
    // The capability is per database, so no row observes ['databases']: the
    // icon of a row costs exactly one query observer, never two.
    expect(databasesObservers()).toBe(0)
  })

  it('shows plain standard icons on a server without icon support', async () => {
    queryClient.setQueryData(['databases'], databasesResponse(database('db')))
    const { container } = renderList([
      entry('e1', { icon: 'ico12.svg' }),
      folder('f1', { icon: 'ico3.svg' }),
    ])
    await settle()
    expect(sources(container).sort()).toEqual(['/icons/ico12.svg', '/icons/ico3.svg'])
    expect(getDatabaseIconsMock).not.toHaveBeenCalled()
  })
})

describe('EntryDetail header icon', () => {
  function renderDetail(compact: EntryCompact) {
    getEntryMock.mockResolvedValue({
      path: [],
      type: compact.type,
      id: compact.id,
      name: compact.name,
      has_second_pass: false,
      icon: compact.icon,
      database_icon: compact.database_icon,
      updated_at: compact.updated_at,
    })
    return render(
      <QueryClientProvider client={queryClient}>
        <EntryDetail dbId="db" compactEntry={compact} />
      </QueryClientProvider>,
    )
  }

  it('shows the database icon of the entry, large', async () => {
    // The header uses its dbId prop, not the navigation store.
    useNavigationStore.getState().setDatabase('not-this-one')
    const { container } = renderDetail(
      entry('e1', { database_icon: { id: '3', name: 'example.com', version: 'v3' } }),
    )
    const header = () => container.querySelector('img.h-10')
    expect(header()?.getAttribute('src')).toBe('/icons/ico0.svg')

    await waitFor(() => expect(header()?.getAttribute('src')).toBe(PNG_DATA_URL))
    expect(getDatabaseIconsMock).toHaveBeenCalledWith('db', ['3'])
  })

  it('shows the standard icon and asks nothing for an entry without one', async () => {
    const { container } = renderDetail(entry('e1', { icon: 'ico12.svg', database_icon: null }))
    await settle()
    expect(container.querySelector('img.h-10')?.getAttribute('src')).toBe('/icons/ico12.svg')
    expect(iconQueries()).toHaveLength(0)
    expect(getDatabaseIconsMock).not.toHaveBeenCalled()
  })
})
