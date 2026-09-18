import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUploadDatabaseIcon } from './useIconMutations'
import { IconUploadAnswerError, uploadDatabaseIcon } from '@/api/icons'
import { ApiError } from '@/api/client'
import { dbIconKey } from '@/lib/dbIcons'
import { PNG_BASE64, PNG_DATA_URL } from '@/test/iconFixtures'
import type { UploadIconResult } from '@/api/types'

vi.mock('@/api/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/icons')>()),
  uploadDatabaseIcon: vi.fn(),
}))

const uploadMock = vi.mocked(uploadDatabaseIcon)

const VARIABLES = { name: 'example.com', data: PNG_BASE64, previewUrl: PNG_DATA_URL }

let queryClient: QueryClient

function renderUpload() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useUploadDatabaseIcon('db'), { wrapper })
}

beforeEach(() => {
  uploadMock.mockReset()
  queryClient = new QueryClient()
})

describe('useUploadDatabaseIcon', () => {
  it('POSTs the name and the base64 PNG - not the preview URL', async () => {
    uploadMock.mockResolvedValue({ id: '7', name: 'example.com', version: 'v7', created: true })
    const { result } = renderUpload()
    await act(() => result.current.mutateAsync(VARIABLES))
    expect(uploadMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).toHaveBeenCalledWith('db', { name: 'example.com', data: PNG_BASE64 })
  })

  it('resolves to the icon as THE SERVER named it', async () => {
    uploadMock.mockResolvedValue({
      id: '8',
      name: 'example.com (2)',
      version: 'v8',
      created: true,
    })
    const { result } = renderUpload()
    let icon
    await act(async () => {
      icon = await result.current.mutateAsync(VARIABLES)
    })
    expect(icon).toEqual({ id: '8', name: 'example.com (2)', version: 'v8' })
  })

  it('primes the image cache under the RETURNED id and version, and re-reads the icon list', async () => {
    uploadMock.mockResolvedValue({ id: '7', name: 'example.com', version: 'v7', created: true })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderUpload()
    await act(() => result.current.mutateAsync(VARIABLES))

    expect(queryClient.getQueryData(dbIconKey('db', '7', 'v7'))).toBe(PNG_DATA_URL)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['db-icons', 'db'] })
    // Only the list: rows change when the entry is saved, not when an icon is stored.
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('treats the 200 of an identical icon (created: false) like a new one', async () => {
    uploadMock.mockResolvedValue({ id: '3', name: 'example.com', version: 'v3', created: false })
    const { result } = renderUpload()
    let icon
    await act(async () => {
      icon = await result.current.mutateAsync(VARIABLES)
    })
    expect(icon).toEqual({ id: '3', name: 'example.com', version: 'v3' })
    expect(queryClient.getQueryData(dbIconKey('db', '3', 'v3'))).toBe(PNG_DATA_URL)
  })

  it.each([
    ['a malformed id', { id: '../7', name: 'example.com', version: 'v7', created: true }],
    ['no version', { id: '7', name: 'example.com', version: '', created: true }],
  ])('with %s the name is still usable, but nothing is cached', async (_what, answer) => {
    uploadMock.mockResolvedValue(answer)
    const { result } = renderUpload()
    let icon: { name: string } | undefined
    await act(async () => {
      icon = await result.current.mutateAsync(VARIABLES)
    })
    expect(icon?.name).toBe('example.com')
    expect(queryClient.getQueryCache().findAll({ queryKey: ['db-icon'] })).toHaveLength(0)
  })

  it.each([
    ['no name', { id: '7', version: 'v7', created: true }],
    ['an empty name', { id: '7', name: '', version: 'v7', created: true }],
    ['no body', undefined],
  ])('an answer with %s is a failure: there is nothing to assign', async (_what, answer) => {
    uploadMock.mockResolvedValue(answer as unknown as UploadIconResult)
    const { result } = renderUpload()
    await act(async () => {
      await expect(result.current.mutateAsync(VARIABLES)).rejects.toBeInstanceOf(
        IconUploadAnswerError,
      )
    })
    expect(queryClient.getQueryCache().findAll({ queryKey: ['db-icon'] })).toHaveLength(0)
  })

  it('passes a refusal on untouched and caches nothing', async () => {
    const refusal = new ApiError(413, 4131, 'too large')
    uploadMock.mockRejectedValue(refusal)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderUpload()
    await act(async () => {
      await expect(result.current.mutateAsync(VARIABLES)).rejects.toBe(refusal)
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(queryClient.getQueryCache().findAll({ queryKey: ['db-icon'] })).toHaveLength(0)
  })
})
