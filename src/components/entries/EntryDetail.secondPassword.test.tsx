import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryDetail } from './EntryDetail'
import { getEntry } from '@/api/entries'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import type { EntryCompact, EntryDetail as FullEntry } from '@/api/types'

vi.mock('@/api/entries', () => ({ getEntry: vi.fn(), getEntryOtp: vi.fn() }))

const getEntryMock = vi.mocked(getEntry)

// Server 20.0.0: an entry of a converted database whose user name, URL and notes the
// earlier version kept under its second password. The listing carries none of them;
// the full read with the second password carries them in their usual members.
function compact(extra: Partial<EntryCompact> = {}): EntryCompact {
  return {
    type: 'password',
    id: 'e1',
    name: 'Converted entry',
    has_second_pass: true,
    icon: 'ico0.svg',
    updated_at: '2026-01-01T00:00:00Z',
    login: '',
    url: '',
    ...extra,
  }
}

function full(extra: Partial<FullEntry> = {}): FullEntry {
  return {
    path: [],
    type: 'password',
    id: 'e1',
    name: 'Converted entry',
    has_second_pass: true,
    icon: 'ico0.svg',
    updated_at: '2026-01-01T00:00:00Z',
    login: 'pm-user',
    pass: 'pm-pass',
    url: 'https://pm.example.test',
    urls: ['https://more.example.test'],
    comments: 'pm-notes',
    ...extra,
  }
}

let queryClient: QueryClient

const noop = () => {}

function Harness({ item }: { item: EntryCompact }) {
  const selected = useNavigationStore((s) => s.selectedEntryId)
  if (!selected) return null
  return (
    <EntryDetail
      key={selected}
      dbId="db"
      compactEntry={selected === item.id ? item : undefined}
      onEdit={noop}
      onMove={noop}
      onDelete={noop}
    />
  )
}

function renderDetail(item: EntryCompact) {
  useNavigationStore.getState().selectEntry(item.id)
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness item={item} />
    </QueryClientProvider>,
  )
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  getEntryMock.mockReset()
  useSecondPasswordStore.getState().clearAll()
  useNavigationStore.getState().setDatabase('db')
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('EntryDetail with a converted second password', () => {
  it('shows the user name, the URLs and the notes the read with the second password answers', async () => {
    getEntryMock.mockResolvedValue(full())
    renderDetail(compact())
    await settle()

    expect(screen.getByText('Second Password Required')).toBeInTheDocument()
    expect(getEntryMock).not.toHaveBeenCalled()
    expect(screen.queryByText('pm-user')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Second Password'), { target: { value: 'second' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    })
    await settle()

    expect(getEntryMock.mock.calls.every(([, , password]) => password === 'second')).toBe(true)
    expect(await screen.findByText('pm-user')).toBeInTheDocument()
    expect(screen.getByText('https://pm.example.test')).toBeInTheDocument()
    expect(screen.getByText('https://more.example.test')).toBeInTheDocument()
    expect(screen.getByText('pm-notes')).toBeInTheDocument()
  })
})
