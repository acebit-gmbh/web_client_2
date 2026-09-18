import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from './authStore'
import { queryClient } from '@/lib/queryClient'
import { dbIconBatcher, dbIconKey } from '@/lib/dbIcons'
import { PNG_DATA_URL } from '@/test/iconFixtures'

vi.mock('@/lib/clipboard', () => ({ clearClipboard: vi.fn() }))
vi.mock('@/api/auth', () => ({ logout: vi.fn(() => Promise.resolve()) }))

describe('authStore.logout and database icons', () => {
  beforeEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
  })

  it('wipes cached icon images and lists - the next login may be to another server', () => {
    queryClient.setQueryData(dbIconKey('db', '3', 'v3'), PNG_DATA_URL)
    queryClient.setQueryData(['db-icons', 'db'], { data: [], total: 0, offset: 0, limit: 200 })

    useAuthStore.getState().logout({ broadcast: false, revoke: false })

    expect(queryClient.getQueryData(dbIconKey('db', '3', 'v3'))).toBeUndefined()
    expect(queryClient.getQueryData(['db-icons', 'db'])).toBeUndefined()
  })

  it('resets the icon loader, so queued icon requests die with the session', () => {
    const reset = vi.spyOn(dbIconBatcher, 'reset')
    useAuthStore.getState().logout({ broadcast: false, revoke: false })
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
