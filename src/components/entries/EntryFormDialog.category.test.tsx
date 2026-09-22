import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryFormDialog } from './EntryFormDialog'
import { listCategories } from '@/api/categories'
import { ApiError } from '@/api/client'
import type { CreateEntryRequest, EntryDetail } from '@/api/types'

/*
  ES-1000. The category field offers the database's own list - the one the
  Windows client offers - and stays free text, because the Windows control is
  an editable combo box and because a server older than 20.0.0 has no list at
  all: it answers 404, and the field must simply carry on.
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

function renderDialog({
  entry,
  dbId = 'db',
  onSubmit,
}: { entry?: EntryDetail; dbId?: string | null; onSubmit?: (d: CreateEntryRequest) => Promise<void> } = {}) {
  const submit = vi.fn(onSubmit ?? (() => Promise.resolve()))
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EntryFormDialog open onClose={vi.fn()} entry={entry} dbId={dbId} onSubmit={submit} isSubmitting={false} />
    </QueryClientProvider>,
  )
  return { ...view, submit }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function categoryInput() {
  // the field sits under the "Category" label of the common fields block
  return screen.getByPlaceholderText(/Banking, Internet/i) as HTMLInputElement
}

describe('category field in EntryFormDialog', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    listMock.mockReset()
    listMock.mockResolvedValue({ data: ['Banking', 'Internet'], total: 2 })
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('offers the database list as suggestions, without restricting the field to it', async () => {
    renderDialog()
    await settle()

    expect(listMock).toHaveBeenCalledWith('db')
    await waitFor(() => expect(screen.getByTestId('category-options')).toBeInTheDocument())

    const options = Array.from(screen.getByTestId('category-options').querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    )
    expect(options).toEqual(['Banking', 'Internet'])

    // the input is a text field bound to the list, not a select
    const input = categoryInput()
    expect(input.tagName).toBe('INPUT')
    expect(input.getAttribute('list')).toBe(screen.getByTestId('category-options').id)
  })

  it('submits a category that is not in the list', async () => {
    const { submit } = renderDialog()
    await settle()

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Mail' } })
    fireEvent.change(categoryInput(), { target: { value: 'Crypto' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({ category: 'Crypto' })
  })

  it('shows the entry category when editing', async () => {
    renderDialog({ entry: detail({ category: 'Internet' }) })
    await settle()
    expect(categoryInput().value).toBe('Internet')
  })

  it('stays usable when the server has no such route', async () => {
    listMock.mockRejectedValue(new ApiError(404, 404, 'Resource not found'))
    const { submit } = renderDialog()
    await settle()

    // no list, no error, still a working text field
    expect(screen.queryByTestId('category-options')).not.toBeInTheDocument()
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Mail' } })
    fireEvent.change(categoryInput(), { target: { value: 'Banking' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({ category: 'Banking' })
  })

  it('does not ask for a list without a database', async () => {
    renderDialog({ dbId: null })
    await settle()
    expect(listMock).not.toHaveBeenCalled()
  })
})
