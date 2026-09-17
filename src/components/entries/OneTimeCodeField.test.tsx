import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import '@/i18n'
import { OneTimeCodeField } from './OneTimeCodeField'
import { getEntryOtp } from '@/api/entries'
import { copyToClipboard } from '@/lib/clipboard'
import { ApiError } from '@/api/client'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import type { EntryOtp } from '@/api/types'

vi.mock('@/api/entries', () => ({ getEntryOtp: vi.fn() }))
vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn(() => Promise.resolve()),
  clearClipboard: vi.fn(),
}))

const getEntryOtpMock = vi.mocked(getEntryOtp)
const copyToClipboardMock = vi.mocked(copyToClipboard)

function otp(expires_in: number, code = '012345'): EntryOtp {
  return { code, digits: code.length, period: 30, expires_in, algorithm: 'SHA1' }
}

function renderField(entryId = 'e1') {
  return render(
    <OneTimeCodeField dbId="db" entryId={entryId} entryName="Mail" entryType="Password" />,
  )
}

const showButton = () => screen.getByRole('button', { name: 'Show code' })

/** Clicks "Show code" and lets the mocked request settle. */
async function clickShow() {
  await act(async () => {
    fireEvent.click(showButton())
    await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

describe('OneTimeCodeField', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    })
    getEntryOtpMock.mockReset()
    copyToClipboardMock.mockClear()
    useSecondPasswordStore.getState().clearAll()
  })

  afterEach(() => {
    setVisibility('visible')
    vi.useRealTimers()
  })

  it('renders masked and does not fetch on mount', () => {
    renderField()
    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(showButton()).toBeEnabled()
    expect(getEntryOtpMock).not.toHaveBeenCalled()
  })

  it('does not fetch on window focus or visibility change', async () => {
    renderField()
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    await advance(10 * 60 * 1000)
    expect(getEntryOtpMock).not.toHaveBeenCalled()
  })

  it('fetches on click with the cached second password and shows the code in groups of 3', async () => {
    useSecondPasswordStore.getState().setSecondPassword('e1', 'sekret')
    getEntryOtpMock.mockResolvedValueOnce(otp(12, '01234567'))
    renderField()

    await clickShow()

    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
    expect(getEntryOtpMock).toHaveBeenCalledWith('db', 'e1', 'sekret')
    expect(screen.getByText('012 345 67')).toBeInTheDocument()
    expect(screen.getByText('12 s left')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show code' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('counts down from expires_in and masks on expiry without refetching', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(12))
    renderField()
    await clickShow()
    expect(screen.getByText('12 s left')).toBeInTheDocument()

    await advance(1000)
    expect(screen.getByText('11 s left')).toBeInTheDocument()

    await advance(10_000)
    expect(screen.getByText('1 s left')).toBeInTheDocument()
    expect(screen.getByText('012 345')).toBeInTheDocument()

    await advance(1250)
    expect(screen.queryByText('012 345')).not.toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(showButton()).toBeEnabled()
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
  })

  it('waits out a code with expires_in <= 2 and refetches exactly once', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(2, '000001')).mockResolvedValueOnce(otp(30, '000002'))
    renderField()
    await clickShow()

    // Not shown, still loading, nothing fetched yet beyond the first call.
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('000 001')).not.toBeInTheDocument()
    expect(showButton()).toBeDisabled()

    await advance(1999)
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)

    await advance(1)
    expect(getEntryOtpMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('000 002')).toBeInTheDocument()
    expect(screen.getByText('30 s left')).toBeInTheDocument()

    await advance(60_000)
    expect(getEntryOtpMock).toHaveBeenCalledTimes(2)
  })

  it('shows the refetched code even when it is short-lived, then masks - never loops', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(1, '000001')).mockResolvedValueOnce(otp(2, '000002'))
    renderField()
    await clickShow()
    await advance(1000)
    expect(getEntryOtpMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText('000 002')).toBeInTheDocument()

    await advance(2250)
    expect(screen.queryByText('000 002')).not.toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(getEntryOtpMock).toHaveBeenCalledTimes(2)
  })

  it('cancels the pending rollover refetch on unmount', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(2))
    const { unmount } = renderField()
    await clickShow()
    unmount()
    await advance(5000)
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
  })

  it('403/4031 clears the cached second password, opens the prompt and retries with the entered one', async () => {
    useSecondPasswordStore.getState().setSecondPassword('e1', 'stale')
    getEntryOtpMock.mockRejectedValueOnce(new ApiError(403, 4031, 'Invalid second password.'))
    renderField()
    await clickShow()

    expect(getEntryOtpMock).toHaveBeenCalledWith('db', 'e1', 'stale')
    expect(useSecondPasswordStore.getState().getSecondPassword('e1')).toBeUndefined()
    expect(screen.getByText('Second Password Required')).toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeInTheDocument()

    getEntryOtpMock.mockResolvedValueOnce(otp(20, '654321'))
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Second Password'), { target: { value: 'fresh' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
      await Promise.resolve()
    })

    expect(getEntryOtpMock).toHaveBeenCalledTimes(2)
    expect(getEntryOtpMock).toHaveBeenLastCalledWith('db', 'e1', 'fresh')
    expect(screen.getByText('654 321')).toBeInTheDocument()
    expect(useSecondPasswordStore.getState().getSecondPassword('e1')).toBe('fresh')
  })

  it('a plain 403 shows the neutral message and does not prompt', async () => {
    useSecondPasswordStore.getState().setSecondPassword('e1', 'kept')
    getEntryOtpMock.mockRejectedValueOnce(new ApiError(403, 403, 'Access denied.'))
    renderField()
    await clickShow()

    expect(screen.getByText('The one-time code is not available for you.')).toBeInTheDocument()
    expect(screen.queryByText('Second Password Required')).not.toBeInTheDocument()
    expect(screen.queryByText('Access denied.')).not.toBeInTheDocument()
    expect(useSecondPasswordStore.getState().getSecondPassword('e1')).toBe('kept')
    expect(showButton()).toBeEnabled()
  })

  it('404/4041 replaces the row with "no one-time code"', async () => {
    getEntryOtpMock.mockRejectedValueOnce(new ApiError(404, 4041, 'No one-time code.'))
    renderField()
    await clickShow()

    expect(screen.getByText('This entry has no one-time code.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show code' })).not.toBeInTheDocument()
    expect(screen.queryByText('••••••')).not.toBeInTheDocument()
  })

  it('501 shows the unsupported message', async () => {
    getEntryOtpMock.mockRejectedValueOnce(new ApiError(501, 501, 'Not implemented.'))
    renderField()
    await clickShow()
    expect(
      screen.getByText('One-time codes are not available for this entry type.'),
    ).toBeInTheDocument()
  })

  it('copies the code with a 20 s clipboard auto-clear', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(25, '000123'))
    renderField()
    await clickShow()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
      await Promise.resolve()
    })
    expect(copyToClipboardMock).toHaveBeenCalledTimes(1)
    expect(copyToClipboardMock).toHaveBeenCalledWith('000123', 20000)
  })

  it('masks when the user hides the code', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(25))
    renderField()
    await clickShow()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hide code' }))
    })
    expect(screen.queryByText('012 345')).not.toBeInTheDocument()
    expect(showButton()).toBeEnabled()
  })

  it('masks when the document becomes hidden', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(25))
    renderField()
    await clickShow()
    expect(screen.getByText('012 345')).toBeInTheDocument()

    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.queryByText('012 345')).not.toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
  })

  it('hiding the tab during the rollover wait cancels the pending refetch', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(2))
    renderField()
    await clickShow()
    expect(showButton()).toBeDisabled()

    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(5000)
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(showButton()).toBeEnabled()
  })

  it('masks on entry change', async () => {
    getEntryOtpMock.mockResolvedValueOnce(otp(25))
    const { rerender } = renderField('e1')
    await clickShow()
    expect(screen.getByText('012 345')).toBeInTheDocument()

    rerender(<OneTimeCodeField dbId="db" entryId="e2" entryName="Other" entryType="Password" />)
    expect(screen.queryByText('012 345')).not.toBeInTheDocument()
    expect(showButton()).toBeEnabled()
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
  })

  it('drops a response that lands after an entry change', async () => {
    let resolve!: (value: EntryOtp) => void
    getEntryOtpMock.mockImplementationOnce(
      () =>
        new Promise<EntryOtp>((r) => {
          resolve = r
        }),
    )
    const { rerender } = renderField('e1')
    await clickShow()
    expect(showButton()).toBeDisabled()

    rerender(<OneTimeCodeField dbId="db" entryId="e2" entryName="Other" entryType="Password" />)
    await act(async () => {
      resolve(otp(25, '999999'))
      await Promise.resolve()
    })
    expect(screen.queryByText('999 999')).not.toBeInTheDocument()
    expect(screen.getByText('••••••')).toBeInTheDocument()
    expect(showButton()).toBeEnabled()
    expect(getEntryOtpMock).toHaveBeenCalledTimes(1)
  })
})
