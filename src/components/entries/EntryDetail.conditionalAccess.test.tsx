import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryDetail } from './EntryDetail'
import { getEntry } from '@/api/entries'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import type { EntryCompact, EntryDetail as FullEntry, EntryWarning } from '@/api/types'

vi.mock('@/api/entries', () => ({ getEntry: vi.fn(), getEntryOtp: vi.fn() }))

const getEntryMock = vi.mocked(getEntry)

const CONFIRM: EntryWarning = {
  message: '  Production root account.\r\nAsk the on-call admin first.\r\n',
  level: 'confirm',
  verify_text: '',
}
const VERIFY: EntryWarning = {
  message: 'Four-eyes rule.',
  level: 'verify',
  verify_text: 'My manager knows',
}
const INFO: EntryWarning = { message: 'Shared with the auditors.', level: 'info', verify_text: '' }

/** What the plaintext read reveals - never on screen before the warning is answered. */
const LOGIN = 'root@prod'

function compact(extra: Partial<EntryCompact> = {}): EntryCompact {
  return {
    type: 'password',
    id: 'e1',
    name: 'Root account',
    has_second_pass: false,
    icon: 'ico0.svg',
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

function full(extra: Partial<FullEntry> = {}): FullEntry {
  return {
    path: [],
    type: 'password',
    id: 'e1',
    name: 'Root account',
    has_second_pass: false,
    icon: 'ico0.svg',
    updated_at: '2026-01-01T00:00:00Z',
    login: LOGIN,
    pass: 'hunter2',
    ...extra,
  }
}

let queryClient: QueryClient

const noop = () => {}

/** Mounts the detail the way VaultPage does: only while an entry is selected, keyed by it. */
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

function ui(item: EntryCompact) {
  return (
    <QueryClientProvider client={queryClient}>
      <Harness item={item} />
    </QueryClientProvider>
  )
}

function renderDetail(item: EntryCompact) {
  useNavigationStore.getState().selectEntry(item.id)
  return render(ui(item))
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const prompt = () => screen.queryByRole('dialog', { name: 'Warning' })
const continueButton = () => screen.getByRole('button', { name: 'Continue' })
// hidden: true - an open modal hides the page behind it from the accessibility
// tree, so without it a button that IS rendered there would not be found.
const editButton = () => screen.queryByRole('button', { name: 'Edit', hidden: true })

async function clickContinue() {
  await act(async () => {
    fireEvent.click(continueButton())
  })
  await settle()
}

beforeEach(() => {
  getEntryMock.mockReset()
  useSecondPasswordStore.getState().clearAll()
  useNavigationStore.getState().setDatabase('db')
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('EntryDetail conditional access', () => {
  it('asks about a confirm warning before the entry is read, and reads it on Continue', async () => {
    getEntryMock.mockResolvedValue(full({ warning: CONFIRM }))
    renderDetail(compact({ warning: CONFIRM }))
    await settle()

    const dialog = prompt()
    expect(dialog).toBeInTheDocument()
    // Rendered as text, line breaks kept, the whitespace around it dropped.
    expect(
      within(dialog!).getByText(/Production root account/, { normalizer: (s) => s }).textContent,
    ).toBe('Production root account.\nAsk the on-call admin first.')
    expect(within(dialog!).getByText('Root account')).toBeInTheDocument()
    expect(within(dialog!).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(continueButton()).toBeEnabled()

    expect(getEntryMock).not.toHaveBeenCalled()
    expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()

    await clickContinue()

    expect(getEntryMock).toHaveBeenCalledTimes(1)
    expect(getEntryMock).toHaveBeenCalledWith('db', 'e1', undefined)
    expect(await screen.findByText(LOGIN)).toBeInTheDocument()
    expect(prompt()).not.toBeInTheDocument()
    // Answered, the warning stays in view above the content.
    expect(screen.getByRole('alert')).toHaveTextContent('Production root account.')
  })

  it('keeps Continue disabled for verify until the box is ticked', async () => {
    getEntryMock.mockResolvedValue(full({ warning: VERIFY }))
    renderDetail(compact({ warning: VERIFY }))
    await settle()

    const box = screen.getByRole('checkbox', { name: 'My manager knows' })
    expect(box).not.toBeChecked()
    expect(continueButton()).toBeDisabled()

    fireEvent.click(continueButton())
    await settle()
    expect(getEntryMock).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(box)
    })
    expect(box).toBeChecked()
    expect(continueButton()).toBeEnabled()

    // Unticking takes it back.
    await act(async () => {
      fireEvent.click(box)
    })
    expect(continueButton()).toBeDisabled()
    await act(async () => {
      fireEvent.click(screen.getByText('My manager knows'))
    })
    expect(continueButton()).toBeEnabled()
    expect(getEntryMock).not.toHaveBeenCalled()

    await clickContinue()
    expect(getEntryMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(LOGIN)).toBeInTheDocument()
  })

  it('a changed warning does not inherit the ticked box', async () => {
    // A listing re-read (window focus) can change the warning while the same
    // prompt stays mounted; the prompt is keyed by the warning, so the new one
    // starts unticked.
    const V2: EntryWarning = { ...VERIFY, message: 'Frozen: incident 42.' }
    const { rerender } = renderDetail(compact({ warning: VERIFY }))
    await settle()
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'My manager knows' }))
    })
    expect(continueButton()).toBeEnabled()

    rerender(ui(compact({ warning: V2 })))
    await settle()
    expect(screen.getByText(/incident 42/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'My manager knows' })).not.toBeChecked()
    expect(continueButton()).toBeDisabled()
    expect(getEntryMock).not.toHaveBeenCalled()
  })

  it('labels the box with the client\'s own "I agree" when the entry sets no text', async () => {
    renderDetail(compact({ warning: { ...VERIFY, verify_text: '' } }))
    await settle()

    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(getEntryMock).not.toHaveBeenCalled()
  })

  it('treats a level it does not know like verify', async () => {
    getEntryMock.mockResolvedValue(full())
    renderDetail(
      compact({ warning: { message: 'Newer server.', level: 'critical', verify_text: '' } }),
    )
    await settle()

    expect(prompt()).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(getEntryMock).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'I agree' }))
    })
    await clickContinue()
    expect(getEntryMock).toHaveBeenCalledTimes(1)
  })

  it('Cancel deselects the entry and never reads it', async () => {
    renderDetail(compact({ warning: CONFIRM }))
    await settle()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    await settle()

    expect(useNavigationStore.getState().selectedEntryId).toBeNull()
    expect(prompt()).not.toBeInTheDocument()
    expect(getEntryMock).not.toHaveBeenCalled()
  })

  it('Escape is a Cancel too', async () => {
    renderDetail(compact({ warning: VERIFY }))
    await settle()

    await act(async () => {
      fireEvent.keyDown(prompt()!, { key: 'Escape' })
    })
    await settle()

    expect(useNavigationStore.getState().selectedEntryId).toBeNull()
    expect(getEntryMock).not.toHaveBeenCalled()
  })

  it('shows an info warning without blocking: reads at once and shows it above the content', async () => {
    getEntryMock.mockResolvedValue(full({ warning: INFO }))
    renderDetail(compact({ warning: INFO }))

    // In view from the first render, before the entry has arrived.
    expect(screen.getByRole('alert')).toHaveTextContent('Shared with the auditors.')
    expect(await screen.findByText(LOGIN)).toBeInTheDocument()
    expect(getEntryMock).toHaveBeenCalledTimes(1)
    expect(prompt()).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Warning')
  })

  it.each([
    ['a server older than 20.0.0 (no key)', {}],
    ['no warning (null)', { warning: null }],
  ])('reads at once and shows nothing for %s', async (_label, extra) => {
    getEntryMock.mockResolvedValue(full(extra))
    renderDetail(compact(extra))

    expect(await screen.findByText(LOGIN)).toBeInTheDocument()
    expect(getEntryMock).toHaveBeenCalledTimes(1)
    expect(prompt()).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('asks before the second password, whose check would read the entry', async () => {
    getEntryMock.mockResolvedValue(full({ has_second_pass: true, warning: CONFIRM }))
    renderDetail(compact({ has_second_pass: true, warning: CONFIRM }))
    await settle()

    expect(prompt()).toBeInTheDocument()
    expect(screen.queryByText('Second Password Required')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Second Password')).not.toBeInTheDocument()
    expect(getEntryMock).not.toHaveBeenCalled()

    await clickContinue()

    // Now the password is asked for - and still nothing has been read.
    expect(screen.getByText('Second Password Required')).toBeInTheDocument()
    expect(getEntryMock).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Second Password'), { target: { value: 'sekret' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    })
    await settle()

    expect(getEntryMock).toHaveBeenCalled()
    expect(getEntryMock.mock.calls.every(([, , password]) => password === 'sekret')).toBe(true)
    expect(await screen.findByText(LOGIN)).toBeInTheDocument()
    expect(prompt()).not.toBeInTheDocument()
  })

  it('asks again when the entry is selected again, even with the entry in the cache', async () => {
    getEntryMock.mockResolvedValue(full({ warning: CONFIRM }))
    const item = compact({ warning: CONFIRM })
    const { rerender } = renderDetail(item)
    await settle()
    await clickContinue()
    expect(await screen.findByText(LOGIN)).toBeInTheDocument()

    await act(async () => {
      useNavigationStore.getState().selectEntry(null)
    })
    rerender(ui(item))
    expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()

    await act(async () => {
      useNavigationStore.getState().selectEntry('e1')
    })
    rerender(ui(item))
    await settle()

    expect(prompt()).toBeInTheDocument()
    expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()
    expect(getEntryMock).toHaveBeenCalledTimes(1)
  })

  describe('a listing older than the entry', () => {
    it('hides the content until a warning the listing did not have is answered', async () => {
      getEntryMock.mockResolvedValue(full({ warning: CONFIRM }))
      renderDetail(compact({ warning: null }))
      await settle()

      // The listing gave no reason to wait, so the entry was read ...
      expect(getEntryMock).toHaveBeenCalledTimes(1)
      // ... but it is not shown until its warning is answered. The prompt
      // appears only once the entry has arrived, so wait for it: asserting
      // before that would find no content whatever the component does.
      expect(await screen.findByRole('dialog', { name: 'Warning' })).toBeInTheDocument()
      expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()
      expect(editButton()).not.toBeInTheDocument()

      await clickContinue()
      expect(screen.getByText(LOGIN)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Production root account.')
      expect(getEntryMock).toHaveBeenCalledTimes(1)
    })

    it('asks again when the entry as read carries a different warning', async () => {
      getEntryMock.mockResolvedValue(full({ warning: VERIFY }))
      renderDetail(compact({ warning: CONFIRM }))
      await settle()
      await clickContinue()

      // The second question appears once the entry has arrived.
      const box = await screen.findByRole('checkbox', { name: 'My manager knows' })
      expect(getEntryMock).toHaveBeenCalledTimes(1)
      expect(prompt()).toBeInTheDocument()
      expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()
      expect(editButton()).not.toBeInTheDocument()
      expect(continueButton()).toBeDisabled()

      await act(async () => {
        fireEvent.click(box)
      })
      await clickContinue()
      expect(screen.getByText(LOGIN)).toBeInTheDocument()
      expect(prompt()).not.toBeInTheDocument()
    })

    it('Cancel on the second question deselects the entry too', async () => {
      getEntryMock.mockResolvedValue(full({ warning: CONFIRM }))
      renderDetail(compact())

      expect(await screen.findByRole('dialog', { name: 'Warning' })).toBeInTheDocument()
      expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      })
      expect(useNavigationStore.getState().selectedEntryId).toBeNull()
      expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()
    })

    it('hides the content again when a refetch brings a new warning', async () => {
      const item = compact({ warning: null })
      getEntryMock.mockResolvedValue(full({ warning: null }))
      const { rerender } = renderDetail(item)
      expect(await screen.findByText(LOGIN)).toBeInTheDocument()

      await act(async () => {
        queryClient.setQueryData(['entry', 'db', 'e1', 'locked'], full({ warning: CONFIRM }))
      })
      // A render of its own: asserting on a DOM that has not been repainted
      // after the cache changed would pass whatever the component does.
      rerender(ui(item))

      expect(await screen.findByRole('dialog', { name: 'Warning' })).toBeInTheDocument()
      expect(screen.queryByText(LOGIN)).not.toBeInTheDocument()
      expect(editButton()).not.toBeInTheDocument()
    })
  })
})
