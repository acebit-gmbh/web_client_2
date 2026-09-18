import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import '@/i18n'
import { useCreateEntry, useUpdateEntry } from './useEntryMutations'
import { createEntry, updateEntry } from '@/api/entries'
import { ApiError } from '@/api/client'
import { useToastStore } from '@/stores/toastStore'

vi.mock('@/api/entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/entries')>()),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
}))

const createMock = vi.mocked(createEntry)
const updateMock = vi.mocked(updateEntry)

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

const toasts = () => useToastStore.getState().toasts

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  useToastStore.getState().clear()
})

// The entry form explains these refusals itself, inline and in the browser's
// language; a toast carrying the server's wording on top would contradict it.
const EXPLAINED_INLINE: [string, ApiError][] = [
  ['a refused icon assignment (400/4007)', new ApiError(400, 4007, 'Server-side wording')],
  ['a refused one-time-code member (400/4003)', new ApiError(400, 4003, 'Server-side wording')],
  ['a one-time-code write without read right (403/4033)', new ApiError(403, 4033, 'Server-side')],
]

const TOASTED: [string, ApiError][] = [
  ['a plain 400', new ApiError(400, 400, 'Bad request')],
  ['a plain 403', new ApiError(403, 403, 'Forbidden')],
  // 4007 is only itself together with 400.
  ['403 carrying 4007', new ApiError(403, 4007, 'Forbidden')],
  ['a server error', new ApiError(500, 500, 'boom')],
]

describe('useCreateEntry', () => {
  it.each(EXPLAINED_INLINE)('%s raises no toast', async (_what, refusal) => {
    createMock.mockRejectedValue(refusal)
    const { result } = renderHook(() => useCreateEntry('db'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ name: 'Mail' })).rejects.toBe(refusal)
    })
    expect(toasts()).toHaveLength(0)
  })

  it.each(TOASTED)('%s keeps its toast', async (_what, refusal) => {
    createMock.mockRejectedValue(refusal)
    const { result } = renderHook(() => useCreateEntry('db'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ name: 'Mail' })).rejects.toBe(refusal)
    })
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].variant).toBe('error')
  })
})

describe('useUpdateEntry', () => {
  it.each(EXPLAINED_INLINE)('%s raises no toast', async (_what, refusal) => {
    updateMock.mockRejectedValue(refusal)
    const { result } = renderHook(() => useUpdateEntry('db'), { wrapper })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ entryId: 'e1', data: { name: 'Mail' } }),
      ).rejects.toBe(refusal)
    })
    expect(toasts()).toHaveLength(0)
  })

  it.each(TOASTED)('%s keeps its toast', async (_what, refusal) => {
    updateMock.mockRejectedValue(refusal)
    const { result } = renderHook(() => useUpdateEntry('db'), { wrapper })
    await act(async () => {
      await expect(
        result.current.mutateAsync({ entryId: 'e1', data: { name: 'Mail' } }),
      ).rejects.toBe(refusal)
    })
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].variant).toBe('error')
  })
})
