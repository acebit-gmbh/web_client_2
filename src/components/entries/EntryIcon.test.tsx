import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EntryIcon } from './EntryIcon'
import { getDatabaseIcon, getDatabaseIcons } from '@/api/icons'
import { dbIconBatcher } from '@/lib/dbIcons'
import { useNavigationStore } from '@/stores/navigationStore'
import type { DatabaseIconRef } from '@/api/types'
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

const getDatabaseIconsMock = vi.mocked(getDatabaseIcons)
const getDatabaseIconMock = vi.mocked(getDatabaseIcon)

const REF: DatabaseIconRef = { id: '3', name: 'example.com', version: 'v3' }

let queryClient: QueryClient

function renderIcon(ui: React.ReactElement) {
  const view = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
  return {
    ...view,
    rerenderIcon: (next: React.ReactElement) =>
      view.rerender(<QueryClientProvider client={queryClient}>{next}</QueryClientProvider>),
    img: () => view.container.querySelector('img'),
    glyph: () => view.container.querySelector('svg'),
  }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function iconQueries() {
  return queryClient.getQueryCache().findAll({ queryKey: ['db-icon'] })
}

function databasesObservers() {
  return (
    queryClient
      .getQueryCache()
      .find({ queryKey: ['databases'] })
      ?.getObserversCount() ?? 0
  )
}

beforeEach(() => {
  dbIconBatcher.reset()
  getDatabaseIconsMock.mockReset()
  getDatabaseIconMock.mockReset()
  getDatabaseIconsMock.mockImplementation(async (_dbId, ids) =>
    iconsResponse(...ids.map((id) => okIcon(id))),
  )
  queryClient = new QueryClient()
  queryClient.setQueryData(
    ['databases'],
    databasesResponse(database('db', ICON_CAPABILITY), database('old')),
  )
  useNavigationStore.getState().setDatabase('db')
})

describe('EntryIcon', () => {
  describe('rows without a database icon', () => {
    it.each([
      ['absent (older server)', undefined],
      ['null', null],
    ])(
      'database_icon %s: shows the bundled standard icon and mounts no image hook',
      async (_l, value) => {
        const view = renderIcon(<EntryIcon type="password" icon="ico12.svg" databaseIcon={value} />)
        await settle()

        expect(view.img()?.getAttribute('src')).toBe('/icons/ico12.svg')
        expect(iconQueries()).toHaveLength(0)
        expect(databasesObservers()).toBe(0)
        expect(getDatabaseIconsMock).not.toHaveBeenCalled()
      },
    )

    it('falls back to the type glyph when the standard icon fails to load', () => {
      const view = renderIcon(<EntryIcon type="password" icon="ico12.svg" />)
      fireEvent.error(view.img()!)
      expect(view.img()).toBeNull()
      expect(view.glyph()).not.toBeNull()
    })

    it('shows the type glyph when the row names no icon at all', () => {
      const view = renderIcon(<EntryIcon type="credit_card" />)
      expect(view.img()).toBeNull()
      expect(view.glyph()).not.toBeNull()
    })
  })

  describe('rows with a database icon', () => {
    it('shows the standard icon while loading, then the database icon, in the same box', async () => {
      const view = renderIcon(
        <EntryIcon type="password" icon="ico0.svg" databaseIcon={REF} className="h-10 w-10" />,
      )
      expect(view.img()?.getAttribute('src')).toBe('/icons/ico0.svg')
      expect(view.img()?.className).toContain('h-10 w-10')

      await waitFor(() => expect(view.img()?.getAttribute('src')).toBe(PNG_DATA_URL))
      expect(view.img()?.className).toContain('h-10 w-10')
      expect(view.img()?.getAttribute('alt')).toBe('')
      expect(getDatabaseIconsMock).toHaveBeenCalledWith('db', ['3'])
    })

    it('displays a data: URL, never a blob: URL (the CSP allows data:, not blob:)', async () => {
      // jsdom has no URL.createObjectURL; install one so a call would be seen.
      const original = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
      const createObjectURL = vi.fn(() => 'blob:nope')
      Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
      try {
        const view = renderIcon(<EntryIcon type="password" icon="ico0.svg" databaseIcon={REF} />)
        await waitFor(() =>
          expect(view.img()?.getAttribute('src')).toMatch(/^data:image\/png;base64,/),
        )
        expect(createObjectURL).not.toHaveBeenCalled()
      } finally {
        if (original) Object.defineProperty(URL, 'createObjectURL', original)
        else delete (URL as { createObjectURL?: unknown }).createObjectURL
      }
    })

    it('uses the database of the navigation store, or the dbId prop when given', async () => {
      queryClient.setQueryData(
        ['databases'],
        databasesResponse(database('db', ICON_CAPABILITY), database('other', ICON_CAPABILITY)),
      )
      const view = renderIcon(
        <EntryIcon type="password" icon="ico0.svg" databaseIcon={REF} dbId="other" />,
      )
      await waitFor(() => expect(view.img()?.getAttribute('src')).toBe(PNG_DATA_URL))
      expect(getDatabaseIconsMock).toHaveBeenCalledWith('other', ['3'])
    })

    it('keeps the standard icon for an unusable database icon', async () => {
      getDatabaseIconsMock.mockResolvedValue(
        iconsResponse({ id: '3', name: 'example.com', version: 'v3', state: 'unusable' }),
      )
      const view = renderIcon(<EntryIcon type="password" icon="ico7.svg" databaseIcon={REF} />)
      await waitFor(() => expect(getDatabaseIconsMock).toHaveBeenCalled())
      await settle()
      expect(view.img()?.getAttribute('src')).toBe('/icons/ico7.svg')
    })

    it('keeps the standard icon when the icon is gone or the request fails', async () => {
      getDatabaseIconsMock.mockResolvedValueOnce(iconsResponse())
      const gone = renderIcon(<EntryIcon type="password" icon="ico7.svg" databaseIcon={REF} />)
      await settle()
      expect(gone.img()?.getAttribute('src')).toBe('/icons/ico7.svg')
      gone.unmount()

      getDatabaseIconsMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      const failed = renderIcon(
        <EntryIcon type="password" icon="ico7.svg" databaseIcon={{ ...REF, id: '4' }} />,
      )
      await settle()
      expect(failed.img()?.getAttribute('src')).toBe('/icons/ico7.svg')
    })

    it('walks the whole chain: database icon -> standard icon -> glyph', async () => {
      const view = renderIcon(<EntryIcon type="password" icon="ico7.svg" databaseIcon={REF} />)
      await waitFor(() => expect(view.img()?.getAttribute('src')).toBe(PNG_DATA_URL))

      // The browser cannot decode the image.
      fireEvent.error(view.img()!)
      expect(view.img()?.getAttribute('src')).toBe('/icons/ico7.svg')

      fireEvent.error(view.img()!)
      expect(view.img()).toBeNull()
      expect(view.glyph()).not.toBeNull()
    })

    it('gives a new icon its own attempt after the previous one failed to decode', async () => {
      const view = renderIcon(<EntryIcon type="password" icon="ico7.svg" databaseIcon={REF} />)
      await waitFor(() => expect(view.img()?.getAttribute('src')).toBe(PNG_DATA_URL))
      fireEvent.error(view.img()!)
      expect(view.img()?.getAttribute('src')).toBe('/icons/ico7.svg')

      // Same component instance, another icon (a legacy BMP, so the URL differs).
      const bmp = btoa('BM' + '\0'.repeat(28))
      getDatabaseIconsMock.mockResolvedValueOnce(
        iconsResponse(okIcon('9', 'v9', { content_type: 'image/bmp', data: bmp })),
      )
      view.rerenderIcon(
        <EntryIcon
          type="password"
          icon="ico7.svg"
          databaseIcon={{ id: '9', name: 'other', version: 'v9' }}
        />,
      )
      await waitFor(() =>
        expect(view.img()?.getAttribute('src')).toBe(`data:image/bmp;base64,${bmp}`),
      )
    })

    it('fetches nothing when the server has no icon support, whatever the row says', async () => {
      const view = renderIcon(
        <EntryIcon type="password" icon="ico7.svg" databaseIcon={REF} dbId="old" />,
      )
      await settle()
      expect(view.img()?.getAttribute('src')).toBe('/icons/ico7.svg')
      expect(getDatabaseIconsMock).not.toHaveBeenCalled()
      expect(getDatabaseIconMock).not.toHaveBeenCalled()
    })

    it('never puts a malformed id into a request', async () => {
      const view = renderIcon(
        <EntryIcon
          type="password"
          icon="ico7.svg"
          databaseIcon={{ id: '../../entries/x', name: 'n', version: 'v' }}
        />,
      )
      await settle()
      expect(view.img()?.getAttribute('src')).toBe('/icons/ico7.svg')
      expect(getDatabaseIconsMock).not.toHaveBeenCalled()
    })
  })
})
