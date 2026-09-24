import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
  type MockInstance,
} from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryList } from './EntryList'
import { useToastStore } from '@/stores/toastStore'
import type { EntryCompact, EntryWarning } from '@/api/types'

vi.mock('@/api/entries', () => ({ getEntry: vi.fn(), getEntryOtp: vi.fn() }))

const CONFIRM: EntryWarning = { message: 'Production!', level: 'confirm', verify_text: '' }
const VERIFY: EntryWarning = {
  message: 'Four-eyes rule.',
  level: 'verify',
  verify_text: 'My manager knows',
}
const INFO: EntryWarning = {
  message: 'Shared with the auditors.\r\n',
  level: 'info',
  verify_text: '',
}

const HREF = 'https://example.com/login'

function entry(extra: Partial<EntryCompact> = {}): EntryCompact {
  return {
    type: 'password',
    id: 'e1',
    name: 'Root account',
    has_second_pass: false,
    icon: 'ico0.svg',
    url: HREF,
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

let queryClient: QueryClient
let openSpy: MockInstance<typeof window.open>
let onEntryClick: Mock<(entryId: string) => void>

function renderList(item: EntryCompact) {
  return render(
    <QueryClientProvider client={queryClient}>
      <EntryList
        items={[item]}
        selectedEntryId={null}
        onFolderClick={() => {}}
        onEntryClick={onEntryClick}
      />
    </QueryClientProvider>,
  )
}

const prompt = () => screen.queryByRole('dialog', { name: 'Warning' })
const continueButton = () => screen.getByRole('button', { name: 'Continue' })

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
  })
}

const clickOpenUrl = () => click(screen.getByRole('button', { name: 'Open URL in new tab' }))

beforeEach(() => {
  queryClient = new QueryClient()
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  onEntryClick = vi.fn()
  useToastStore.getState().clear()
})

afterEach(() => {
  openSpy.mockRestore()
})

describe('EntryList open-URL icon and conditional access', () => {
  it('asks about a confirm warning first and opens only on Continue', async () => {
    renderList(entry({ warning: CONFIRM }))
    await clickOpenUrl()

    expect(prompt()).toBeInTheDocument()
    expect(screen.getByText('Production!')).toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()

    await click(continueButton())
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledWith(HREF, '_blank', 'noopener,noreferrer')
    expect(prompt()).not.toBeInTheDocument()
    // Opening a URL is not opening the entry.
    expect(onEntryClick).not.toHaveBeenCalled()
  })

  it('opens nothing on Cancel', async () => {
    renderList(entry({ warning: CONFIRM }))
    await clickOpenUrl()
    await click(screen.getByRole('button', { name: 'Cancel' }))

    expect(prompt()).not.toBeInTheDocument()
    expect(openSpy).not.toHaveBeenCalled()
    expect(onEntryClick).not.toHaveBeenCalled()
  })

  it('keeps Continue disabled for verify until the box is ticked', async () => {
    renderList(entry({ warning: VERIFY }))
    await clickOpenUrl()

    expect(continueButton()).toBeDisabled()
    await click(continueButton())
    expect(openSpy).not.toHaveBeenCalled()

    await click(screen.getByRole('checkbox', { name: 'My manager knows' }))
    await click(continueButton())
    expect(openSpy).toHaveBeenCalledTimes(1)
  })

  it('treats a level it does not know like verify', async () => {
    renderList(entry({ warning: { message: 'Newer server.', level: 'critical', verify_text: '' } }))
    await clickOpenUrl()

    expect(prompt()).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'I agree' })).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('asks every time the icon is used', async () => {
    renderList(entry({ warning: CONFIRM }))
    await clickOpenUrl()
    await click(continueButton())
    await clickOpenUrl()

    expect(prompt()).toBeInTheDocument()
    expect(openSpy).toHaveBeenCalledTimes(1)
  })

  it('shows an info warning as a toast and opens at once', async () => {
    renderList(entry({ warning: INFO }))
    await clickOpenUrl()

    expect(prompt()).not.toBeInTheDocument()
    expect(openSpy).toHaveBeenCalledTimes(1)
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({
      variant: 'warning',
      title: 'Warning',
      message: 'Shared with the auditors.',
    })
  })

  it.each([
    ['a server older than 20.0.0 (no key)', {}],
    ['no warning (null)', { warning: null }],
  ])('opens at once and shows nothing for %s', async (_label, extra) => {
    renderList(entry(extra))
    await clickOpenUrl()

    expect(prompt()).not.toBeInTheDocument()
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
