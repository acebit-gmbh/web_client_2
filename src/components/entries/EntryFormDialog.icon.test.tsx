import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryFormDialog } from './EntryFormDialog'
import {
  getDatabaseIcon,
  getDatabaseIcons,
  listDatabaseIcons,
  uploadDatabaseIcon,
} from '@/api/icons'
import { ApiError } from '@/api/client'
import { dbIconBatcher } from '@/lib/dbIcons'
import { useTotpCapabilityStore } from '@/stores/totpCapabilityStore'
import type { CreateEntryRequest, DatabaseIconRef, EntryDetail, EntryType } from '@/api/types'
import {
  ICON_CAPABILITY,
  PNG_BASE64,
  database,
  databasesResponse,
  iconsResponse,
  okIcon,
} from '@/test/iconFixtures'
import { imageFile, installCanvasMock } from '@/test/canvasMock'

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

const EXAMPLE: DatabaseIconRef = { id: '3', name: 'example.com', version: 'v3' }
const BANK: DatabaseIconRef = { id: '7', name: 'Bank & Co', version: 'v7' }

const ICON_KEYS = ['image_custom', 'image_index', 'image_name'] as const

function detail(extra: Partial<EntryDetail> = {}): EntryDetail {
  return {
    path: [],
    type: 'password',
    id: 'e1',
    name: 'Mail',
    has_second_pass: false,
    updated_at: '2026-01-01T00:00:00Z',
    icon: 'ico0.svg',
    database_icon: null,
    image_custom: false,
    image_index: 0,
    image_name: '',
    ...extra,
  }
}

interface RenderOptions {
  entry?: EntryDetail
  defaultType?: EntryType
  /** Which database object the `['databases']` cache holds for "db"; null = the query has no data. */
  databases?: 'with-icons' | 'without-icons' | null
  dbId?: string | null
  onSubmit?: (data: CreateEntryRequest) => Promise<void>
}

let queryClient: QueryClient
let canvas: ReturnType<typeof installCanvasMock> | undefined

function renderDialog({
  entry,
  defaultType,
  databases = 'with-icons',
  dbId = 'db',
  onSubmit,
}: RenderOptions = {}) {
  if (databases) {
    queryClient.setQueryData(
      ['databases'],
      databasesResponse(database('db', databases === 'with-icons' ? ICON_CAPABILITY : undefined)),
    )
  }
  const submit = vi.fn(onSubmit ?? (() => Promise.resolve()))
  const onClose = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EntryFormDialog
        open
        onClose={onClose}
        entry={entry}
        defaultType={defaultType}
        dbId={dbId}
        onSubmit={submit}
        isSubmitting={false}
      />
    </QueryClientProvider>,
  )
  return { ...view, submit, onClose }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function submitForm(isEditing: boolean) {
  if (!isEditing) {
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Mail' } })
  }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: isEditing ? 'Save' : 'Create' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function submittedBody(submit: ReturnType<typeof vi.fn>, call = 0): CreateEntryRequest {
  return submit.mock.calls[call][0] as CreateEntryRequest
}

function iconKeysOf(body: CreateEntryRequest) {
  return Object.fromEntries(ICON_KEYS.filter((key) => key in body).map((key) => [key, body[key]]))
}

const changeButton = () => screen.queryByRole('button', { name: 'Change icon' })

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Change icon' }))
}

async function openTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }))
  await settle()
  // The icon list is a query: wait until it has answered, one way or the other.
  await waitFor(() => expect(screen.queryByText('Loading icons...')).not.toBeInTheDocument())
}

beforeEach(() => {
  dbIconBatcher.reset()
  useTotpCapabilityStore.getState().clearAll()
  listMock.mockReset()
  batchMock.mockReset()
  singleMock.mockReset()
  uploadMock.mockReset()
  listMock.mockResolvedValue(iconsResponse(EXAMPLE, BANK))
  batchMock.mockImplementation(async (_dbId, ids) => iconsResponse(...ids.map((id) => okIcon(id))))
  // No IntersectionObserver in jsdom: every tile counts as seen.
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  canvas?.restore()
  canvas = undefined
})

describe('icon picker in EntryFormDialog', () => {
  describe('feature gate', () => {
    it('create: shown when the database carries `icons` - even an empty database with no rows cached', () => {
      renderDialog()
      expect(queryClient.getQueriesData({ queryKey: ['children'] })).toHaveLength(0)
      expect(changeButton()).toBeInTheDocument()
      expect(screen.getByText('Default icon of the entry type')).toBeInTheDocument()
    })

    it.each(['password', 'credit_card', 'identity', 'rdp', 'document'] as const)(
      'create: offered for a %s entry',
      (type) => {
        renderDialog({ defaultType: type })
        expect(changeButton()).toBeInTheDocument()
      },
    )

    it('hidden on an older server (database without `icons`), and nothing icon-related is sent', async () => {
      const { submit } = renderDialog({
        databases: 'without-icons',
        entry: detail({ image_custom: true, image_index: 3, image_name: 'example.com' }),
      })
      expect(changeButton()).not.toBeInTheDocument()
      expect(screen.queryByText('Icon')).not.toBeInTheDocument()
      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({})
      expect(listMock).not.toHaveBeenCalled()
      expect(batchMock).not.toHaveBeenCalled()
    })

    it('hidden while the databases are not known, and without a database id', () => {
      const first = renderDialog({ databases: null })
      expect(changeButton()).not.toBeInTheDocument()
      first.unmount()
      renderDialog({ dbId: null })
      expect(changeButton()).not.toBeInTheDocument()
    })

    it('never makes the form fetch /databases itself', async () => {
      renderDialog({ databases: null })
      await settle()
      expect(queryClient.getQueryState(['databases'])?.fetchStatus ?? 'idle').toBe('idle')
    })
  })

  describe('request body', () => {
    it('unchanged (edit): none of the icon keys is sent - not even as an echo', async () => {
      const { submit } = renderDialog({
        entry: detail({
          image_custom: true,
          image_index: 3,
          image_name: 'example.com',
          database_icon: EXAMPLE,
        }),
      })
      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({})
    })

    it('unchanged (create): none of the icon keys is sent', async () => {
      const { submit } = renderDialog()
      await submitForm(false)
      expect(iconKeysOf(submittedBody(submit))).toEqual({})
    })

    it('opening the picker and looking around changes nothing', async () => {
      const { submit } = renderDialog({ entry: detail({ image_index: 12, icon: 'ico12.svg' }) })
      openPicker()
      await openTab('This database')
      await openTab('Standard')
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({})
    })

    it('standard(n): image_custom false + image_index n', async () => {
      const { submit } = renderDialog()
      openPicker()
      fireEvent.click(screen.getByRole('button', { name: 'Standard icon 13' }))
      await submitForm(false)
      expect(iconKeysOf(submittedBody(submit))).toEqual({ image_custom: false, image_index: 12 })
    })

    it('standard 0 is a choice like any other', async () => {
      const { submit } = renderDialog({
        entry: detail({ type: 'credit_card', image_index: 126, icon: 'ico126.svg' }),
      })
      openPicker()
      fireEvent.click(screen.getByRole('button', { name: 'Standard icon 1' }))
      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({ image_custom: false, image_index: 0 })
    })

    it('default: image_custom false + image_index -1', async () => {
      const { submit } = renderDialog({
        entry: detail({
          image_custom: true,
          image_index: 3,
          image_name: 'example.com',
          database_icon: EXAMPLE,
        }),
      })
      openPicker()
      await openTab('Standard')
      fireEvent.click(screen.getByRole('button', { name: 'Default for type' }))
      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({ image_custom: false, image_index: -1 })
    })

    it('custom(name): image_custom true + image_name - never a position', async () => {
      const { submit } = renderDialog({ entry: detail({ image_index: 12, icon: 'ico12.svg' }) })
      openPicker()
      await openTab('This database')
      fireEvent.click(screen.getByRole('button', { name: 'Bank & Co' }))
      await submitForm(true)
      const body = submittedBody(submit)
      expect(iconKeysOf(body)).toEqual({ image_custom: true, image_name: 'Bank & Co' })
      expect(body).not.toHaveProperty('image_index')
    })

    it('closing the dialog drops the choice, like the one-time-code editing state', async () => {
      // The parents unmount the dialog, so today every open is a fresh
      // instance - but if that ever stops being true, entry A's icon must not
      // be written to entry B (a valid name in this database: a silent wrong
      // write, not a refusal).
      const { submit } = renderDialog({ entry: detail() })
      openPicker()
      fireEvent.click(screen.getByRole('button', { name: 'Standard icon 13' }))
      expect(screen.getByRole('button', { name: 'Undo icon change' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('button', { name: 'Undo icon change' })).not.toBeInTheDocument()
      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({})
    })

    it('the undo returns to "nothing is sent"', async () => {
      const { submit } = renderDialog({ entry: detail() })
      openPicker()
      fireEvent.click(screen.getByRole('button', { name: 'Standard icon 13' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo icon change' }))
      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({})
    })

    it('leaves the rest of the body as it was', async () => {
      const { submit } = renderDialog({ entry: detail({ login: 'alice', url: 'example.com' }) })
      openPicker()
      fireEvent.click(screen.getByRole('button', { name: 'Standard icon 13' }))
      await submitForm(true)
      expect(submittedBody(submit)).toMatchObject({
        name: 'Mail',
        login: 'alice',
        url: 'example.com',
        image_custom: false,
        image_index: 12,
      })
      expect(submittedBody(submit)).not.toHaveProperty('totp')
    })
  })

  describe('preselection from the loaded entry', () => {
    it('a standard icon is described and marked', () => {
      renderDialog({ entry: detail({ image_index: 12, icon: 'ico12.svg' }) })
      expect(screen.getByText('Standard icon 13')).toBeInTheDocument()
      openPicker()
      expect(screen.getByRole('tab', { name: 'Standard' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('button', { name: 'Standard icon 13' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('a database icon opens "This database" with its tile marked', async () => {
      renderDialog({
        entry: detail({
          image_custom: true,
          image_index: 1,
          image_name: 'Bank & Co',
          database_icon: BANK,
        }),
      })
      expect(screen.getByText('Database icon: Bank & Co')).toBeInTheDocument()
      openPicker()
      await settle()
      expect(screen.getByRole('tab', { name: 'This database' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(await screen.findByRole('button', { name: 'Bank & Co' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'example.com' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })

    it('the server-maintained position of a database icon is never shown as a standard icon', () => {
      renderDialog({
        entry: detail({
          image_custom: true,
          image_index: 12,
          image_name: 'example.com',
          database_icon: EXAMPLE,
        }),
      })
      expect(screen.queryByText('Standard icon 13')).not.toBeInTheDocument()
    })
  })

  describe('upload, then save', () => {
    it('saves the entry with the name the upload answered', async () => {
      canvas = installCanvasMock()
      uploadMock.mockResolvedValue({
        id: '8',
        name: 'example.com (2)',
        version: 'v8',
        created: true,
      })
      const { submit } = renderDialog({ entry: detail({ url: 'https://example.com/login' }) })
      openPicker()
      await openTab('Upload')
      await act(async () => {
        fireEvent.change(screen.getByTestId('icon-file-input'), {
          target: { files: [imageFile('logo.png', 'image/png')] },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await settle()
      expect(screen.getByLabelText('Icon name')).toHaveValue('example.com')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Upload and use' }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(uploadMock).toHaveBeenCalledWith('db', { name: 'example.com', data: PNG_BASE64 })
      // The upload is a request of its own: the entry has not been saved by it.
      expect(submit).not.toHaveBeenCalled()

      await submitForm(true)
      expect(iconKeysOf(submittedBody(submit))).toEqual({
        image_custom: true,
        image_name: 'example.com (2)',
      })
    })

    it('a failed save keeps the uploaded icon selected for the retry - nothing is rolled back', async () => {
      canvas = installCanvasMock()
      uploadMock.mockResolvedValue({ id: '8', name: 'example.com', version: 'v8', created: true })
      let attempts = 0
      const { submit, onClose } = renderDialog({
        entry: detail({ url: 'example.com' }),
        onSubmit: () =>
          ++attempts === 1 ? Promise.reject(new ApiError(500, 500, 'boom')) : Promise.resolve(),
      })
      openPicker()
      await openTab('Upload')
      await act(async () => {
        fireEvent.change(screen.getByTestId('icon-file-input'), {
          target: { files: [imageFile('logo.png', 'image/png')] },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await settle()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Upload and use' }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await submitForm(true)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByText('Database icon: example.com')).toBeInTheDocument()

      await submitForm(true)
      expect(submit).toHaveBeenCalledTimes(2)
      expect(iconKeysOf(submittedBody(submit, 1))).toEqual({
        image_custom: true,
        image_name: 'example.com',
      })
      // One upload only: the retry re-sends the entry, not the image.
      expect(uploadMock).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not save while a chosen image is still waiting to be uploaded', async () => {
      canvas = installCanvasMock()
      const { submit } = renderDialog({ entry: detail() })
      openPicker()
      await openTab('Upload')
      await act(async () => {
        fireEvent.change(screen.getByTestId('icon-file-input'), {
          target: { files: [imageFile('logo.png', 'image/png')] },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await settle()
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))

      await submitForm(true)
      expect(submit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You have chosen an image that is not uploaded yet. Upload it or discard it, then save.',
      )
      // The picker is unfolded again, on the tab that holds the image.
      expect(screen.getByRole('tab', { name: 'Upload' })).toHaveAttribute('aria-selected', 'true')

      fireEvent.click(screen.getByRole('button', { name: 'Discard image' }))
      await submitForm(true)
      expect(submit).toHaveBeenCalledTimes(1)
      expect(iconKeysOf(submittedBody(submit))).toEqual({})
    })
  })

  describe('refused assignment (400 / 4007)', () => {
    it('is explained inline in the browser language, the list is re-read and the picker reopened', async () => {
      const { submit, onClose } = renderDialog({
        entry: detail({ image_index: 12, icon: 'ico12.svg' }),
        onSubmit: () => Promise.reject(new ApiError(400, 4007, 'Server-side wording')),
      })
      openPicker()
      await openTab('This database')
      fireEvent.click(screen.getByRole('button', { name: 'Bank & Co' }))
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
      expect(listMock).toHaveBeenCalledTimes(1)
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

      // Meanwhile the icon was removed: the re-read list no longer has it.
      listMock.mockResolvedValue(iconsResponse(EXAMPLE))
      await submitForm(true)
      await settle()

      expect(submit).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(
        'The selected icon no longer exists in this database. Choose another icon.',
      )
      expect(alert).not.toHaveTextContent('Server-side wording')

      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['db-icons', 'db'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['children', 'db'] })
      expect(screen.getByRole('tab', { name: 'This database' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(listMock).toHaveBeenCalledTimes(2)
      const grid = screen.getByRole('group', { name: 'Icons of this database' })
      expect(within(grid).getAllByRole('button')).toHaveLength(1)

      // The refused choice is gone: the row is back at the stored icon, and
      // saving again sends no icon keys.
      expect(screen.getByText('Standard icon 13')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Undo icon change' })).not.toBeInTheDocument()
    })

    it('other save failures are left to the toast and keep the choice', async () => {
      renderDialog({
        entry: detail(),
        onSubmit: () => Promise.reject(new ApiError(403, 403, 'Forbidden')),
      })
      openPicker()
      fireEvent.click(screen.getByRole('button', { name: 'Standard icon 13' }))
      await submitForm(true)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Undo icon change' })).toBeInTheDocument()
    })

    it('a one-time-code refusal still wins its own message', async () => {
      renderDialog({
        entry: detail({
          totp: { state: 'set', writable: true, digits: 6, period: 30, algorithm: 'SHA1' },
        }),
        onSubmit: () => Promise.reject(new ApiError(400, 4003, 'Server-side wording')),
      })
      await submitForm(true)
      expect(screen.getByRole('alert')).toHaveTextContent('A one-time code has 6 to 8 digits.')
    })
  })
})
