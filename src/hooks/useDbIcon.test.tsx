import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useDbIcon } from './useDbIcon'
import { useDatabaseIcons } from './useDatabaseIcons'
import { getDatabaseIcon, getDatabaseIcons, listDatabaseIcons } from '@/api/icons'
import { ApiError } from '@/api/client'
import { dbIconBatcher, dbIconKey } from '@/lib/dbIcons'
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
  listDatabaseIcons: vi.fn(),
}))

const getDatabaseIconsMock = vi.mocked(getDatabaseIcons)
const getDatabaseIconMock = vi.mocked(getDatabaseIcon)
const listDatabaseIconsMock = vi.mocked(listDatabaseIcons)

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

/** A query client whose databases query says: "db" has icon support, "old" has not. */
function clientWithDatabases(capability = ICON_CAPABILITY) {
  const queryClient = new QueryClient()
  queryClient.setQueryData(
    ['databases'],
    databasesResponse(database('db', capability), database('old')),
  )
  return queryClient
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
  listDatabaseIconsMock.mockReset()
  getDatabaseIconsMock.mockImplementation(async (_dbId, ids) =>
    iconsResponse(...ids.map((id) => okIcon(id))),
  )
})

describe('useDbIcon', () => {
  it('loads the image and caches it under (database, id, version)', async () => {
    const queryClient = clientWithDatabases()
    const { result } = renderHook(() => useDbIcon('db', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    expect(result.current).toBeUndefined()

    await waitFor(() => expect(result.current).toBe(PNG_DATA_URL))
    expect(getDatabaseIconsMock).toHaveBeenCalledTimes(1)
    expect(getDatabaseIconsMock).toHaveBeenCalledWith('db', ['3'])
    expect(queryClient.getQueryData(dbIconKey('db', '3', 'v3'))).toBe(PNG_DATA_URL)
  })

  it('fetches nothing on a server without the icons capability', async () => {
    const queryClient = clientWithDatabases()
    const { result } = renderHook(() => useDbIcon('old', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    await settle()
    expect(result.current).toBeUndefined()
    expect(getDatabaseIconsMock).not.toHaveBeenCalled()
    expect(getDatabaseIconMock).not.toHaveBeenCalled()
  })

  it('fetches nothing without a database', async () => {
    const queryClient = clientWithDatabases()
    renderHook(() => useDbIcon(null, { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    await settle()
    expect(getDatabaseIconsMock).not.toHaveBeenCalled()
  })

  it('batches the hooks of one render into one request, chunked by the published batch_max', async () => {
    const queryClient = clientWithDatabases({ ...ICON_CAPABILITY, batch_max: 2 })
    const { result } = renderHook(
      () => [
        useDbIcon('db', { id: '1', version: 'v1' }),
        useDbIcon('db', { id: '2', version: 'v2' }),
        useDbIcon('db', { id: '3', version: 'v3' }),
      ],
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(result.current).toEqual(Array(3).fill(PNG_DATA_URL)))
    expect(getDatabaseIconsMock.mock.calls.map(([, ids]) => ids)).toEqual([['1', '2'], ['3']])
  })

  it('shares one request between rows that use the same icon', async () => {
    const queryClient = clientWithDatabases()
    const { result } = renderHook(
      () => [
        useDbIcon('db', { id: '3', version: 'v3' }),
        useDbIcon('db', { id: '3', version: 'v3' }),
      ],
      { wrapper: wrapperFor(queryClient) },
    )
    await waitFor(() => expect(result.current).toEqual([PNG_DATA_URL, PNG_DATA_URL]))
    expect(getDatabaseIconsMock).toHaveBeenCalledTimes(1)
    expect(getDatabaseIconsMock).toHaveBeenCalledWith('db', ['3'])
  })

  it('serves a later mount from the cache - the image of a version never goes stale', async () => {
    const queryClient = clientWithDatabases()
    const first = renderHook(() => useDbIcon('db', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() => expect(first.result.current).toBe(PNG_DATA_URL))
    first.unmount()

    // Make everything "old", then mount again and poke the refetch triggers.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20 * 60 * 1000)
    const second = renderHook(() => useDbIcon('db', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    expect(second.result.current).toBe(PNG_DATA_URL)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('online'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    vi.restoreAllMocks()
    expect(getDatabaseIconsMock).toHaveBeenCalledTimes(1)
  })

  it('negative-caches an unusable icon: null, and no second request on remount', async () => {
    getDatabaseIconsMock.mockResolvedValue(
      iconsResponse({ id: '3', name: 'a', version: 'v3', state: 'unusable' }),
    )
    const queryClient = clientWithDatabases()
    const first = renderHook(() => useDbIcon('db', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() => expect(first.result.current).toBeNull())
    first.unmount()

    const second = renderHook(() => useDbIcon('db', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    await settle()
    expect(second.result.current).toBeNull()
    expect(getDatabaseIconsMock).toHaveBeenCalledTimes(1)
  })

  it('negative-caches an icon that is gone', async () => {
    getDatabaseIconsMock.mockResolvedValue(iconsResponse())
    const queryClient = clientWithDatabases()
    const { result } = renderHook(() => useDbIcon('db', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() => expect(result.current).toBeNull())
    expect(queryClient.getQueryState(dbIconKey('db', '3', 'v3'))?.status).toBe('success')
  })

  it('does not retry a failed request, and stays undefined (fallback)', async () => {
    getDatabaseIconsMock.mockRejectedValue(new ApiError(500, 500, 'boom'))
    const queryClient = clientWithDatabases()
    const { result } = renderHook(() => useDbIcon('db', { id: '3', version: 'v3' }), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() =>
      expect(queryClient.getQueryState(dbIconKey('db', '3', 'v3'))?.status).toBe('error'),
    )
    await settle()
    expect(result.current).toBeUndefined()
    expect(getDatabaseIconsMock).toHaveBeenCalledTimes(1)
  })

  it('a stale row gets the fallback now and the image after the rows were re-read', async () => {
    getDatabaseIconsMock.mockResolvedValue(iconsResponse(okIcon('3', 'v-new')))
    const queryClient = clientWithDatabases()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const { result, rerender } = renderHook(
      ({ version }) => useDbIcon('db', { id: '3', version }),
      { wrapper: wrapperFor(queryClient), initialProps: { version: 'v-old' } },
    )
    await waitFor(() => expect(result.current).toBeNull())
    await settle()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['children', 'db'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['search', 'db'] })

    // The re-read row carries the new version: served from the cache, no request.
    rerender({ version: 'v-new' })
    expect(result.current).toBe(PNG_DATA_URL)
    await settle()
    expect(getDatabaseIconsMock).toHaveBeenCalledTimes(1)
  })
})

describe('useDatabaseIcons', () => {
  const LIST = {
    data: [{ id: '3', name: 'example.com', version: 'v3' }],
    total: 1,
    offset: 0,
    limit: 200,
  }

  it('lists the icons of a database that reports the capability', async () => {
    listDatabaseIconsMock.mockResolvedValue(LIST)
    const queryClient = clientWithDatabases()
    const { result } = renderHook(() => useDatabaseIcons('db'), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() => expect(result.current.data).toEqual(LIST))
    expect(listDatabaseIconsMock).toHaveBeenCalledWith('db')
    expect(queryClient.getQueryData(['db-icons', 'db'])).toEqual(LIST)
  })

  it('works for an empty database (the capability needs no entry row)', async () => {
    listDatabaseIconsMock.mockResolvedValue({ data: [], total: 0, offset: 0, limit: 200 })
    const queryClient = clientWithDatabases()
    const { result } = renderHook(() => useDatabaseIcons('db'), {
      wrapper: wrapperFor(queryClient),
    })
    await waitFor(() => expect(result.current.data?.data).toEqual([]))
  })

  it('never asks an older server', async () => {
    const queryClient = clientWithDatabases()
    const { result } = renderHook(() => useDatabaseIcons('old'), {
      wrapper: wrapperFor(queryClient),
    })
    await settle()
    expect(result.current.fetchStatus).toBe('idle')
    expect(listDatabaseIconsMock).not.toHaveBeenCalled()
  })

  it('asks nothing without a database', async () => {
    const queryClient = clientWithDatabases()
    renderHook(() => useDatabaseIcons(null), { wrapper: wrapperFor(queryClient) })
    await settle()
    expect(listDatabaseIconsMock).not.toHaveBeenCalled()
  })
})
