import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { findIconCapability, useIconCapability } from './useIconCapability'
import { listDatabases } from '@/api/databases'
import type { DatabaseCompact, DatabaseIconsCapability } from '@/api/types'
import { ICON_CAPABILITY, database, databasesResponse } from '@/test/iconFixtures'

vi.mock('@/api/databases', () => ({ listDatabases: vi.fn() }))
const listDatabasesMock = vi.mocked(listDatabases)

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('findIconCapability', () => {
  const listing = databasesResponse(database('new', ICON_CAPABILITY), database('old'))

  it('returns the icons object of the database', () => {
    expect(findIconCapability(listing, 'new')).toEqual(ICON_CAPABILITY)
  })

  it('is undefined for a database without the object (older server)', () => {
    expect(findIconCapability(listing, 'old')).toBeUndefined()
  })

  it('is undefined for an unknown database, no database and no listing', () => {
    expect(findIconCapability(listing, 'other')).toBeUndefined()
    expect(findIconCapability(listing, null)).toBeUndefined()
    expect(findIconCapability(undefined, 'new')).toBeUndefined()
  })

  it('counts an empty object as support: presence is the marker, not the values', () => {
    const empty = {} as DatabaseIconsCapability
    expect(findIconCapability(databasesResponse(database('d', empty)), 'd')).toBe(empty)
  })

  it.each([null, true, 1, 'yes'])('does not count the non-object %j', (value) => {
    const odd = { ...database('d'), icons: value } as unknown as DatabaseCompact
    expect(findIconCapability(databasesResponse(odd), 'd')).toBeUndefined()
  })
})

describe('useIconCapability', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    listDatabasesMock.mockReset()
    queryClient = new QueryClient()
  })

  it('reads the capability from the cached databases query', () => {
    queryClient.setQueryData(['databases'], databasesResponse(database('db', ICON_CAPABILITY)))
    const { result } = renderHook(() => useIconCapability('db'), {
      wrapper: wrapperFor(queryClient),
    })
    expect(result.current).toEqual(ICON_CAPABILITY)
  })

  it('is known for an empty database - no entry row is needed', () => {
    queryClient.setQueryData(['databases'], databasesResponse(database('empty', ICON_CAPABILITY)))
    const { result } = renderHook(() => useIconCapability('empty'), {
      wrapper: wrapperFor(queryClient),
    })
    expect(result.current?.can_upload).toBe(true)
  })

  it('is undefined on an older server', () => {
    queryClient.setQueryData(['databases'], databasesResponse(database('db')))
    const { result } = renderHook(() => useIconCapability('db'), {
      wrapper: wrapperFor(queryClient),
    })
    expect(result.current).toBeUndefined()
  })

  it('never fetches /databases itself, not even with an empty or stale cache', async () => {
    const { result, rerender } = renderHook(() => useIconCapability('db'), {
      wrapper: wrapperFor(queryClient),
    })
    expect(result.current).toBeUndefined()

    queryClient.setQueryData(['databases'], databasesResponse(database('db', ICON_CAPABILITY)), {
      updatedAt: Date.now() - 60 * 60 * 1000,
    })
    rerender()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(listDatabasesMock).not.toHaveBeenCalled()
  })

  it('follows the databases query when it changes', async () => {
    queryClient.setQueryData(['databases'], databasesResponse(database('db')))
    const { result } = renderHook(() => useIconCapability('db'), {
      wrapper: wrapperFor(queryClient),
    })
    expect(result.current).toBeUndefined()

    // (TanStack delivers observer updates on its own next tick.)
    act(() => {
      queryClient.setQueryData(['databases'], databasesResponse(database('db', ICON_CAPABILITY)))
    })
    await waitFor(() => expect(result.current).toEqual(ICON_CAPABILITY))
  })

  it('switches with the database', () => {
    queryClient.setQueryData(
      ['databases'],
      databasesResponse(database('new', ICON_CAPABILITY), database('old')),
    )
    const { result, rerender } = renderHook(({ dbId }) => useIconCapability(dbId), {
      wrapper: wrapperFor(queryClient),
      initialProps: { dbId: 'new' as string | null },
    })
    expect(result.current).toEqual(ICON_CAPABILITY)
    rerender({ dbId: 'old' })
    expect(result.current).toBeUndefined()
    rerender({ dbId: null })
    expect(result.current).toBeUndefined()
  })
})
