import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import '@/i18n'
import { IconPicker, type IconPickerHandle } from './IconPicker'
import {
  getDatabaseIcon,
  getDatabaseIcons,
  listDatabaseIcons,
  uploadDatabaseIcon,
} from '@/api/icons'
import { ApiError } from '@/api/client'
import { dbIconBatcher, dbIconKey } from '@/lib/dbIcons'
import { ICON_UNCHANGED, type IconChoice, type IconSelection } from '@/lib/iconChoice'
import type { DatabaseIconRef, DatabaseIconsCapability } from '@/api/types'
import {
  ICON_CAPABILITY,
  PNG_BASE64,
  PNG_DATA_URL,
  database,
  databasesResponse,
  iconsResponse,
  okIcon,
} from '@/test/iconFixtures'
import { imageFile, installCanvasMock, MOCK_PREVIEW_URL, pngOfSize } from '@/test/canvasMock'

vi.mock('@/api/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/icons')>()),
  listDatabaseIcons: vi.fn(),
  getDatabaseIcons: vi.fn(),
  getDatabaseIcon: vi.fn(),
  uploadDatabaseIcon: vi.fn(),
}))

const listMock = vi.mocked(listDatabaseIcons)
const batchMock = vi.mocked(getDatabaseIcons)
const singleMock = vi.mocked(getDatabaseIcon)
const uploadMock = vi.mocked(uploadDatabaseIcon)

function ref(id: string, name: string): DatabaseIconRef {
  return { id, name, version: `v${id}` }
}

const LISTED = [ref('3', 'example.com'), ref('7', 'Bank & Co'), ref('12', 'logo.png')]

/** IntersectionObserver double: nothing is on screen until the test says so. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly callback: IntersectionObserverCallback
  readonly targets = new Set<Element>()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe(element: Element) {
    this.targets.add(element)
  }
  unobserve(element: Element) {
    this.targets.delete(element)
  }
  disconnect() {
    this.targets.clear()
  }
  takeRecords() {
    return []
  }
  static reveal(...elements: Element[]) {
    for (const observer of FakeIntersectionObserver.instances) {
      const entries = elements
        .filter((element) => observer.targets.has(element))
        .map((target) => ({ isIntersecting: true, target }))
      if (entries.length > 0) {
        observer.callback(
          entries as unknown as IntersectionObserverEntry[],
          observer as unknown as IntersectionObserver,
        )
      }
    }
  }
}

let queryClient: QueryClient
let canvas: ReturnType<typeof installCanvasMock> | undefined

interface HarnessProps {
  stored?: IconSelection
  capability?: DatabaseIconsCapability
  entryUrl?: string | null
  onChange?: (next: IconChoice) => void
  onSubmit?: () => void
  handle?: { current: IconPickerHandle | null }
}

function Harness({
  stored = { kind: 'default' },
  capability = ICON_CAPABILITY,
  entryUrl,
  onChange,
  onSubmit,
  handle: handleRef,
}: HarnessProps) {
  const [value, setValue] = useState<IconChoice>(ICON_UNCHANGED)
  const pickerRef = useRef<IconPickerHandle>(null)
  return (
    // A form around it, as in the entry dialog: the picker must never submit it.
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
    >
      <IconPicker
        ref={(instance) => {
          pickerRef.current = instance
          if (handleRef) handleRef.current = instance
        }}
        dbId="db"
        capability={capability}
        entryType="password"
        stored={stored}
        storedIconFile="ico0.svg"
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
        entryUrl={entryUrl}
      />
    </form>
  )
}

function renderPicker(props: HarnessProps = {}) {
  const onChange = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness onChange={onChange} {...props} />
    </QueryClientProvider>,
  )
  return { ...view, onChange }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Change icon' }))
}

async function openTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }))
  await settle()
  // The icon list is a query: wait until it has answered, one way or the other.
  await waitFor(() => expect(screen.queryByText('Loading icons...')).not.toBeInTheDocument())
}

function tile(name: string) {
  return screen.getByRole('button', { name })
}

function fileInput(): HTMLInputElement {
  return screen.getByTestId('icon-file-input') as HTMLInputElement
}

async function chooseFile(file: File) {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await settle()
}

async function clickUpload() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Upload and use' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  dbIconBatcher.reset()
  listMock.mockReset()
  batchMock.mockReset()
  singleMock.mockReset()
  uploadMock.mockReset()
  listMock.mockResolvedValue(iconsResponse(...LISTED))
  batchMock.mockImplementation(async (_dbId, ids) => iconsResponse(...ids.map((id) => okIcon(id))))
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(['databases'], databasesResponse(database('db', ICON_CAPABILITY)))
  FakeIntersectionObserver.instances = []
})

afterEach(() => {
  canvas?.restore()
  canvas = undefined
  vi.unstubAllGlobals()
})

describe('IconPicker', () => {
  describe('row', () => {
    it('shows the stored icon and stays folded: nothing is fetched for it', async () => {
      renderPicker()
      await settle()
      expect(screen.getByText('Default icon of the entry type')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Change icon' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Undo icon change' })).not.toBeInTheDocument()
      expect(listMock).not.toHaveBeenCalled()
      expect(batchMock).not.toHaveBeenCalled()
    })

    it('describes a stored standard icon and a stored database icon', async () => {
      const first = renderPicker({ stored: { kind: 'standard', index: 12 } })
      expect(screen.getByText('Standard icon 13')).toBeInTheDocument()
      expect(first.container.querySelector('img')?.getAttribute('src')).toBe('/icons/ico12.svg')
      first.unmount()

      const second = renderPicker({
        stored: { kind: 'custom', name: 'example.com', icon: LISTED[0] },
      })
      expect(screen.getByText('Database icon: example.com')).toBeInTheDocument()
      // The same chain as in the lists: the image comes through the batcher.
      await waitFor(() =>
        expect(second.container.querySelector('img')?.getAttribute('src')).toBe(PNG_DATA_URL),
      )
      expect(batchMock).toHaveBeenCalledWith('db', ['3'])
    })

    it('says so when the assigned database icon no longer exists, and shows the standard icon', () => {
      const view = renderPicker({ stored: { kind: 'custom', name: 'gone.example', icon: null } })
      expect(
        screen.getByText('The assigned database icon is no longer available'),
      ).toBeInTheDocument()
      expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/icons/ico0.svg')
      expect(batchMock).not.toHaveBeenCalled()
    })
  })

  describe('tabs', () => {
    it('offers Standard, This database and Upload when the database accepts uploads', () => {
      renderPicker()
      openPicker()
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Standard',
        'This database',
        'Upload',
      ])
      expect(screen.getByRole('tab', { name: 'Standard' })).toHaveAttribute('aria-selected', 'true')
    })

    it.each([
      ['false', { ...ICON_CAPABILITY, can_upload: false }],
      [
        'missing',
        { ...ICON_CAPABILITY, can_upload: undefined } as unknown as DatabaseIconsCapability,
      ],
      [
        'not a boolean',
        { ...ICON_CAPABILITY, can_upload: 'yes' } as unknown as DatabaseIconsCapability,
      ],
    ])('hides Upload when can_upload is %s', (_what, capability) => {
      renderPicker({ capability })
      openPicker()
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'Standard',
        'This database',
      ])
      expect(screen.queryByTestId('icon-file-input')).not.toBeInTheDocument()
    })

    it('"Done" folds the picker again', () => {
      renderPicker()
      openPicker()
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    })
  })

  describe('standard icons', () => {
    it('offers all 135 bundled icons plus "Default for type"', () => {
      renderPicker()
      openPicker()
      const grid = screen.getByRole('group', { name: 'Standard icons' })
      const tiles = within(grid).getAllByRole('button')
      expect(tiles).toHaveLength(135)
      expect(tiles[0].querySelector('img')?.getAttribute('src')).toBe('/icons/ico0.svg')
      expect(tiles[134].querySelector('img')?.getAttribute('src')).toBe('/icons/ico134.svg')
      expect(screen.getByRole('button', { name: 'Default for type' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      // Bundled files: no server request of any kind.
      expect(batchMock).not.toHaveBeenCalled()
      expect(listMock).not.toHaveBeenCalled()
    })

    it('picking a tile reports standard(n), marks it and updates the row', () => {
      const { onChange } = renderPicker()
      openPicker()
      fireEvent.click(tile('Standard icon 13'))
      expect(onChange).toHaveBeenLastCalledWith({ kind: 'standard', index: 12 })
      expect(tile('Standard icon 13')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'Default for type' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      expect(screen.getAllByText('Standard icon 13').length).toBeGreaterThan(0)
    })

    it('"Default for type" reports default, and the undo returns to unchanged', () => {
      const { onChange } = renderPicker({ stored: { kind: 'standard', index: 5 } })
      openPicker()
      expect(tile('Standard icon 6')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Default for type' }))
      expect(onChange).toHaveBeenLastCalledWith({ kind: 'default' })
      expect(tile('Standard icon 6')).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(screen.getByRole('button', { name: 'Undo icon change' }))
      expect(onChange).toHaveBeenLastCalledWith({ kind: 'unchanged' })
      expect(tile('Standard icon 6')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByRole('button', { name: 'Undo icon change' })).not.toBeInTheDocument()
    })

    it('only one tile is a tab stop, and the arrow keys move between tiles', () => {
      renderPicker({ stored: { kind: 'standard', index: 5 } })
      openPicker()
      const grid = screen.getByRole('group', { name: 'Standard icons' })
      const tabStops = () =>
        within(grid)
          .getAllByRole('button')
          .filter((button) => button.tabIndex === 0)
      expect(tabStops()).toEqual([tile('Standard icon 6')])

      tile('Standard icon 6').focus()
      fireEvent.keyDown(tile('Standard icon 6'), { key: 'ArrowRight' })
      expect(document.activeElement).toBe(tile('Standard icon 7'))
      fireEvent.keyDown(tile('Standard icon 7'), { key: 'Home' })
      expect(document.activeElement).toBe(tile('Standard icon 1'))
      fireEvent.keyDown(tile('Standard icon 1'), { key: 'ArrowLeft' })
      expect(document.activeElement).toBe(tile('Standard icon 1'))
      fireEvent.keyDown(tile('Standard icon 1'), { key: 'End' })
      expect(document.activeElement).toBe(tile('Standard icon 135'))

      // The tab stop follows the focus (roving tabindex), so leaving the grid
      // and coming back resumes where the user was, not at the selection.
      expect(tabStops()).toEqual([tile('Standard icon 135')])
    })
  })

  describe('icons of this database', () => {
    it('lists them only when the tab is opened, and picking one reports custom(ref)', async () => {
      const { onChange } = renderPicker()
      openPicker()
      expect(listMock).not.toHaveBeenCalled()

      await openTab('This database')
      expect(listMock).toHaveBeenCalledTimes(1)
      expect(listMock).toHaveBeenCalledWith('db')
      const grid = screen.getByRole('group', { name: 'Icons of this database' })
      expect(
        within(grid)
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label')),
      ).toEqual(['example.com', 'Bank & Co', 'logo.png'])

      fireEvent.click(tile('Bank & Co'))
      expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', icon: LISTED[1] })
      expect(tile('Bank & Co')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Database icon: Bank & Co')).toBeInTheDocument()
    })

    it('without IntersectionObserver every tile loads - in ONE batched request', async () => {
      vi.stubGlobal('IntersectionObserver', undefined)
      renderPicker()
      openPicker()
      await openTab('This database')
      await waitFor(() =>
        expect(tile('example.com').querySelector('img')?.getAttribute('src')).toBe(PNG_DATA_URL),
      )
      expect(batchMock).toHaveBeenCalledTimes(1)
      expect(batchMock).toHaveBeenCalledWith('db', ['3', '7', '12'])
      expect(singleMock).not.toHaveBeenCalled()
    })

    it('loads an image only once its tile has been on screen (IntersectionObserver)', async () => {
      vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
      renderPicker()
      openPicker()
      await openTab('This database')
      await settle()
      // One observer for the grid, every tile watched, nothing requested yet.
      expect(FakeIntersectionObserver.instances.filter((o) => o.targets.size > 0)).toHaveLength(1)
      expect(batchMock).not.toHaveBeenCalled()
      expect(tile('example.com').querySelector('img')).toBeNull()

      act(() => FakeIntersectionObserver.reveal(tile('example.com'), tile('logo.png')))
      await waitFor(() =>
        expect(tile('example.com').querySelector('img')?.getAttribute('src')).toBe(PNG_DATA_URL),
      )
      // The two visible tiles share a request; the hidden one was never asked for.
      expect(batchMock).toHaveBeenCalledTimes(1)
      expect(batchMock).toHaveBeenCalledWith('db', ['3', '12'])
      expect(tile('Bank & Co').querySelector('img')).toBeNull()
      // A tile that was seen is not watched any more.
      expect(FakeIntersectionObserver.instances.flatMap((o) => [...o.targets])).toEqual([
        tile('Bank & Co'),
      ])
    })

    it('an unusable image leaves a placeholder; the icon can still be picked', async () => {
      vi.stubGlobal('IntersectionObserver', undefined)
      batchMock.mockResolvedValue(
        iconsResponse({ id: '3', name: 'example.com', version: 'v3', state: 'unusable' }),
      )
      listMock.mockResolvedValue(iconsResponse(LISTED[0]))
      const { onChange } = renderPicker()
      openPicker()
      await openTab('This database')
      await settle()
      expect(tile('example.com').querySelector('img')).toBeNull()
      fireEvent.click(tile('example.com'))
      expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', icon: LISTED[0] })
    })

    it('opens on this tab with the stored icon marked - names compare case-insensitively', async () => {
      renderPicker({ stored: { kind: 'custom', name: 'EXAMPLE.com', icon: LISTED[0] } })
      openPicker()
      await settle()
      expect(screen.getByRole('tab', { name: 'This database' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(await screen.findByRole('button', { name: 'example.com' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(tile('logo.png')).toHaveAttribute('aria-pressed', 'false')
    })

    it('ignores listed items it could neither address nor assign', async () => {
      listMock.mockResolvedValue(
        iconsResponse(
          LISTED[0],
          { id: '../4', name: 'evil', version: 'v' },
          { id: '5', name: '', version: 'v5' },
          { id: '6', name: 'no-version', version: '' },
          { ...LISTED[0], name: 'duplicate id' },
        ),
      )
      renderPicker()
      openPicker()
      await openTab('This database')
      const grid = screen.getByRole('group', { name: 'Icons of this database' })
      expect(within(grid).getAllByRole('button')).toHaveLength(1)
    })

    it('offers a name filter once there are many icons', async () => {
      const many = Array.from({ length: 30 }, (_, i) => ref(String(i + 1), `site-${i + 1}.example`))
      listMock.mockResolvedValue(iconsResponse(...many))
      const onSubmit = vi.fn()
      renderPicker({ onSubmit })
      openPicker()
      await openTab('This database')
      const filter = screen.getByRole('searchbox', { name: 'Filter by name' })
      fireEvent.change(filter, { target: { value: 'SITE-2' } })
      const grid = screen.getByRole('group', { name: 'Icons of this database' })
      // site-2 and site-20 .. site-29
      expect(within(grid).getAllByRole('button')).toHaveLength(11)

      fireEvent.change(filter, { target: { value: 'nothing like it' } })
      expect(screen.getByText('No icon matches the filter.')).toBeInTheDocument()

      fireEvent.keyDown(filter, { key: 'Enter' })
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('has no filter for a handful of icons', async () => {
      renderPicker()
      openPicker()
      await openTab('This database')
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    })

    it.each([
      [true, 'This database has no icons yet. Upload an image to add the first one.'],
      [false, 'This database has no icons yet.'],
    ])('empty database (can_upload %s)', async (canUpload, text) => {
      listMock.mockResolvedValue(iconsResponse())
      renderPicker({ capability: { ...ICON_CAPABILITY, can_upload: canUpload } })
      openPicker()
      await openTab('This database')
      expect(screen.getByText(text)).toBeInTheDocument()
    })

    it('a failed list offers a retry', async () => {
      listMock.mockRejectedValueOnce(new ApiError(500, 500, 'boom'))
      renderPicker()
      openPicker()
      await openTab('This database')
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The icons of this database could not be loaded.',
      )
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(listMock).toHaveBeenCalledTimes(2)
      expect(tile('example.com')).toBeInTheDocument()
    })
  })

  describe('upload', () => {
    it('accepts raster images only - never SVG', async () => {
      renderPicker()
      openPicker()
      await openTab('Upload')
      expect(fileInput().accept).toBe('image/png,image/jpeg,image/gif,image/webp,image/bmp')
      expect(screen.queryByRole('button', { name: 'Upload and use' })).not.toBeInTheDocument()
    })

    it('prepares 64 x 64, previews from a data: URL and suggests the host of the entry URL', async () => {
      canvas = installCanvasMock({ width: 300, height: 300 })
      renderPicker({ entryUrl: 'https://www.example.com/login' })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('Company Logo.jpg', 'image/jpeg'))

      const preview = screen.getByAltText('Preview of the new icon')
      expect(preview.getAttribute('src')).toBe(MOCK_PREVIEW_URL)
      expect(screen.getByLabelText('Icon name')).toHaveValue('www.example.com')
      expect(canvas.canvases.map((c) => [c.width, c.height])).toEqual([[64, 64]])
      // Nothing has been sent by choosing a file.
      expect(uploadMock).not.toHaveBeenCalled()
    })

    it('suggests the file name when the entry has no URL', async () => {
      canvas = installCanvasMock()
      renderPicker({ entryUrl: '' })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('Company Logo.final.png', 'image/png'))
      expect(screen.getByLabelText('Icon name')).toHaveValue('Company Logo.final')
    })

    it('uploads, then selects the icon under the name THE SERVER answered', async () => {
      canvas = installCanvasMock()
      uploadMock.mockResolvedValue({
        id: '8',
        name: 'example.com (2)',
        version: 'v8',
        created: true,
      })
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      const handle = { current: null as IconPickerHandle | null }
      const { onChange, container } = renderPicker({ entryUrl: 'example.com', handle })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('logo.png', 'image/png'))
      expect(handle.current?.hasPendingUpload()).toBe(true)
      fireEvent.change(screen.getByLabelText('Icon name'), { target: { value: '  example.com ' } })
      await clickUpload()

      expect(uploadMock).toHaveBeenCalledTimes(1)
      expect(uploadMock).toHaveBeenCalledWith('db', { name: 'example.com', data: PNG_BASE64 })
      expect(onChange).toHaveBeenLastCalledWith({
        kind: 'custom',
        icon: { id: '8', name: 'example.com (2)', version: 'v8' },
      })
      expect(screen.getByText('Database icon: example.com (2)')).toBeInTheDocument()
      // The rename changes what will be written, and the panel that asked for
      // it is gone: it is announced, and the focus lands back on the picker.
      expect(screen.getByRole('status')).toHaveTextContent(
        'Another icon already uses this name, so the new icon was stored as "example.com (2)".',
      )
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change icon' }))

      // The picture is already cached under the returned version: the row
      // shows it without a download, and the icon list is re-read.
      expect(queryClient.getQueryData(dbIconKey('db', '8', 'v8'))).toBe(MOCK_PREVIEW_URL)
      await waitFor(() =>
        expect(container.querySelector('img')?.getAttribute('src')).toBe(MOCK_PREVIEW_URL),
      )
      expect(batchMock).not.toHaveBeenCalled()
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['db-icons', 'db'] })

      // Done: folded, and nothing is waiting to be uploaded any more.
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(handle.current?.hasPendingUpload()).toBe(false)
    })

    it('says nothing about a rename when the server kept the name', async () => {
      canvas = installCanvasMock()
      uploadMock.mockResolvedValue({ id: '3', name: 'Example.com', version: 'v3', created: false })
      const { onChange } = renderPicker({ entryUrl: 'example.com' })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('logo.png', 'image/png'))
      await clickUpload()
      expect(onChange).toHaveBeenLastCalledWith({
        kind: 'custom',
        icon: { id: '3', name: 'Example.com', version: 'v3' },
      })
      expect(screen.queryByText(/was stored as/)).not.toBeInTheDocument()
    })

    it('refuses locally when the 64 x 64 PNG exceeds icons.max_bytes: nothing is sent', async () => {
      canvas = installCanvasMock({ encoded: pngOfSize(32769) })
      const handle = { current: null as IconPickerHandle | null }
      renderPicker({ handle })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('photo.jpg', 'image/jpeg'))

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Even at 64 × 64 pixels the image is larger than 32 KB. Choose a simpler image.',
      )
      expect(screen.queryByRole('button', { name: 'Upload and use' })).not.toBeInTheDocument()
      expect(canvas.toBlob).toHaveBeenCalledTimes(1)
      expect(uploadMock).not.toHaveBeenCalled()
      expect(handle.current?.hasPendingUpload()).toBe(false)
    })

    it('honours a smaller max_bytes published by the database', async () => {
      canvas = installCanvasMock({ encoded: pngOfSize(2049) })
      renderPicker({ capability: { ...ICON_CAPABILITY, max_bytes: 2048 } })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('photo.jpg', 'image/jpeg'))
      expect(screen.getByRole('alert')).toHaveTextContent('larger than 2 KB')
    })

    it.each([
      ['an SVG', imageFile('logo.svg', 'image/svg+xml'), /This file type is not supported/],
      [
        'a huge file',
        imageFile('huge.png', 'image/png', 10 * 1024 * 1024 + 1),
        /The file is too large \(at most 10 MB\)/,
      ],
    ])('refuses %s without decoding it', async (_what, file, message) => {
      canvas = installCanvasMock()
      renderPicker()
      openPicker()
      await openTab('Upload')
      await chooseFile(file)
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(canvas.createImageBitmap).not.toHaveBeenCalled()
      expect(uploadMock).not.toHaveBeenCalled()
    })

    it('reports a file that is not an image', async () => {
      canvas = installCanvasMock({ decodeFails: true })
      renderPicker()
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('broken.png', 'image/png'))
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The image could not be read. Choose another file.',
      )
    })

    it.each([
      ['', 'Enter a name for the icon.'],
      ['   ', 'Enter a name for the icon.'],
      ['a'.repeat(101), 'The name may have at most 100 characters.'],
      ['日'.repeat(81), 'The name is too long for the server. Shorten it.'],
      [
        `bad${String.fromCharCode(1)}name`,
        'The name contains characters that are not allowed (control characters).',
      ],
    ])('applies the name rules of the server before sending (%j)', async (name, message) => {
      canvas = installCanvasMock()
      renderPicker()
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('logo.png', 'image/png'))
      fireEvent.change(screen.getByLabelText('Icon name'), { target: { value: name } })
      await clickUpload()
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(screen.getByLabelText('Icon name')).toHaveAttribute('aria-invalid', 'true')
      expect(uploadMock).not.toHaveBeenCalled()
    })

    it.each([
      [new ApiError(400, 4008, 'server text'), 'The server could not use this image.'],
      [new ApiError(413, 4131, 'server text'), 'The server refused the image as too large.'],
      [new ApiError(403, 4034, 'server text'), 'This database cannot hold any more icons.'],
      [new ApiError(403, 403, 'server text'), 'the server is a read-only mirror'],
      [new ApiError(400, 400, 'server text'), 'The server did not accept the icon name.'],
      [new TypeError('Failed to fetch'), 'The image may be too large, or the connection was lost.'],
    ])(
      'explains a refused upload inline (%s) and keeps the image for another try',
      async (err, message) => {
        canvas = installCanvasMock()
        uploadMock.mockRejectedValue(err)
        const handle = { current: null as IconPickerHandle | null }
        const { onChange } = renderPicker({ entryUrl: 'example.com', handle })
        openPicker()
        await openTab('Upload')
        await chooseFile(imageFile('logo.png', 'image/png'))
        await clickUpload()

        expect(screen.getByRole('alert')).toHaveTextContent(message)
        expect(screen.getByRole('alert')).not.toHaveTextContent('server text')
        expect(onChange).not.toHaveBeenCalled()
        expect(screen.getByAltText('Preview of the new icon')).toBeInTheDocument()
        expect(handle.current?.hasPendingUpload()).toBe(true)
        // One request: no second attempt at another size (the canvas is always 64 x 64).
        expect(uploadMock).toHaveBeenCalledTimes(1)
        expect(canvas.toBlob).toHaveBeenCalledTimes(1)
      },
    )

    it('Enter in the name field uploads - it never submits the form around the picker', async () => {
      canvas = installCanvasMock()
      uploadMock.mockResolvedValue({ id: '8', name: 'example.com', version: 'v8', created: true })
      const onSubmit = vi.fn()
      renderPicker({ entryUrl: 'example.com', onSubmit })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('logo.png', 'image/png'))
      await act(async () => {
        fireEvent.keyDown(screen.getByLabelText('Icon name'), { key: 'Enter' })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(uploadMock).toHaveBeenCalledTimes(1)
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('keeps the chosen image while other tabs are visited; "Discard image" drops it', async () => {
      canvas = installCanvasMock()
      const handle = { current: null as IconPickerHandle | null }
      renderPicker({ handle })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('logo.png', 'image/png'))
      await openTab('Standard')
      await openTab('Upload')
      expect(screen.getByAltText('Preview of the new icon')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Discard image' }))
      expect(screen.queryByAltText('Preview of the new icon')).not.toBeInTheDocument()
      expect(handle.current?.hasPendingUpload()).toBe(false)
    })

    it('picking an existing icon instead drops the image that was waiting', async () => {
      canvas = installCanvasMock()
      const handle = { current: null as IconPickerHandle | null }
      renderPicker({ handle })
      openPicker()
      await openTab('Upload')
      await chooseFile(imageFile('logo.png', 'image/png'))
      await openTab('Standard')
      fireEvent.click(tile('Standard icon 1'))
      expect(handle.current?.hasPendingUpload()).toBe(false)
      expect(uploadMock).not.toHaveBeenCalled()
    })
  })

  describe('handle', () => {
    it('open(tab) unfolds the picker on that tab', async () => {
      const handle = { current: null as IconPickerHandle | null }
      renderPicker({ handle })
      act(() => handle.current?.open('database'))
      await settle()
      expect(screen.getByRole('tab', { name: 'This database' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(listMock).toHaveBeenCalledTimes(1)
    })

    it('open("upload") falls back to Standard when uploads are not allowed', () => {
      const handle = { current: null as IconPickerHandle | null }
      renderPicker({ handle, capability: { ...ICON_CAPABILITY, can_upload: false } })
      act(() => handle.current?.open('upload'))
      expect(screen.getByRole('tab', { name: 'Standard' })).toHaveAttribute('aria-selected', 'true')
    })
  })
})
