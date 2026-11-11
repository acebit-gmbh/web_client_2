import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryFormDialog } from './EntryFormDialog'
import { listCategories } from '@/api/categories'
import type { CreateEntryRequest, EntryDetail } from '@/api/types'
import { inTimeZone } from '@/test/timeZone'

/*
  REST dates. expires_at names a calendar day: Server 20.0.0 answers it as
  midnight UTC of the day and takes the date part of a written value as
  written. The form shows the day by its date part in UTC and sends the picked
  day as midnight UTC, in every time zone of the user (this test process only);
  Valid Thru is checked as the server checks it.
*/

vi.mock('@/api/categories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/categories')>()),
  listCategories: vi.fn(),
}))

const listMock = vi.mocked(listCategories)

let queryClient: QueryClient

function detail(extra: Partial<EntryDetail> = {}): EntryDetail {
  return {
    path: [],
    type: 'password',
    id: 'e1',
    name: 'Mail',
    has_second_pass: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  } as EntryDetail
}

function renderDialog(entry?: EntryDetail) {
  const submit = vi.fn<(data: CreateEntryRequest) => Promise<void>>(() => Promise.resolve())
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EntryFormDialog
        open
        onClose={vi.fn()}
        entry={entry}
        dbId="db"
        onSubmit={submit}
        isSubmitting={false}
      />
    </QueryClientProvider>,
  )
  return { ...view, submit }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function dateInput(): HTMLInputElement {
  const input = document.querySelector('input[type="date"]')
  if (!input) throw new Error('no date input')
  return input as HTMLInputElement
}

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
  'expires_at in the entry form in %s',
  (zone) => {
    inTimeZone(zone)

    beforeEach(() => {
      queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      listMock.mockReset()
      listMock.mockResolvedValue({ data: [], total: 0 })
    })

    afterEach(() => {
      queryClient.clear()
    })

    it('shows the day the server answered and sends it back unchanged', async () => {
      const { submit } = renderDialog(detail({ expires_at: '2029-12-31T00:00:00.000Z' }))
      await settle()
      expect(dateInput().value).toBe('2029-12-31')

      await press('Save')
      await waitFor(() => expect(submit).toHaveBeenCalled())
      expect(submit.mock.calls[0][0]).toMatchObject({ expires_at: '2029-12-31T00:00:00.000Z' })
    })

    it('sends a picked day as midnight UTC of that day', async () => {
      const { submit } = renderDialog(detail({ expires_at: null }))
      await settle()
      fireEvent.change(dateInput(), { target: { value: '2030-01-01' } })

      await press('Save')
      await waitFor(() => expect(submit).toHaveBeenCalled())
      expect(submit.mock.calls[0][0]).toMatchObject({ expires_at: '2030-01-01T00:00:00.000Z' })
    })

    it('sends null for no day', async () => {
      const { submit } = renderDialog(detail({ expires_at: '2029-12-31T00:00:00.000Z' }))
      await settle()
      fireEvent.change(dateInput(), { target: { value: '' } })

      await press('Save')
      await waitFor(() => expect(submit).toHaveBeenCalled())
      expect(submit.mock.calls[0][0]).toMatchObject({ expires_at: null })
    })
  },
)

describe('Valid Thru in the entry form', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    listMock.mockReset()
    listMock.mockResolvedValue({ data: [], total: 0 })
  })

  afterEach(() => {
    queryClient.clear()
  })

  function card(validThru: string): EntryDetail {
    return detail({ type: 'credit_card', name: 'Card', credit_card: { valid_thru: validThru } })
  }

  it('sends a Valid Thru the server takes, exactly as MM/YYYY', async () => {
    const { submit } = renderDialog(card('12/2199'))
    await settle()

    await press('Save')
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({ credit_card: { valid_thru: '12/2199' } })
    expect(submit.mock.calls[0][0]).not.toHaveProperty('expires_at')
  })

  it('refuses a year the server does not take, before sending anything', async () => {
    const { submit } = renderDialog(card('12/2300'))
    await settle()

    await press('Save')
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText(/MM\/YYYY/)).toBeInTheDocument()
  })
})
