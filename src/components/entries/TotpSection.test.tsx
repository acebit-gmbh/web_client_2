import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryFormDialog } from './EntryFormDialog'
import { useTotpCapabilityStore } from '@/stores/totpCapabilityStore'
import { ApiError } from '@/api/client'
import type {
  CreateEntryRequest,
  EntryCompact,
  EntryDetail,
  EntryTotp,
  EntryType,
} from '@/api/types'

// RFC 6238 test vector - never a real seed.
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

const STORED: EntryTotp = {
  state: 'set',
  writable: true,
  digits: 6,
  period: 30,
  algorithm: 'SHA1',
  conforming: true,
}

function row(extra: Partial<EntryCompact> = {}): EntryCompact {
  return {
    type: 'password',
    id: 'e1',
    name: 'Mail',
    has_second_pass: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

function detail(extra: Partial<EntryDetail> = {}): EntryDetail {
  return {
    path: [],
    type: 'password',
    id: 'e1',
    name: 'Mail',
    has_second_pass: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

interface RenderOptions {
  entry?: EntryDetail
  defaultType?: EntryType
  /** Compact rows seeded into the children cache of database "db"; null seeds nothing. */
  rows?: EntryCompact[] | null
  onSubmit?: (data: CreateEntryRequest) => Promise<void>
}

function renderDialog({ entry, defaultType, rows = null, onSubmit }: RenderOptions = {}) {
  const queryClient = new QueryClient()
  if (rows) {
    queryClient.setQueryData(['children', 'db', null], {
      path: [],
      data: rows,
      total: rows.length,
      offset: 0,
      limit: 100,
    })
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
        dbId="db"
        onSubmit={submit}
        isSubmitting={false}
      />
    </QueryClientProvider>,
  )
  return { ...view, submit, onClose }
}

const sectionTitle = () => screen.queryByText('One-Time Code')

/** Fills the required name (the first text box in the form) and submits. */
async function submitForm(isEditing: boolean) {
  if (!isEditing) {
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Mail' } })
  }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: isEditing ? 'Save' : 'Create' }))
    await Promise.resolve()
  })
}

function submittedBody(submit: ReturnType<typeof vi.fn>): CreateEntryRequest {
  expect(submit).toHaveBeenCalledTimes(1)
  return submit.mock.calls[0][0] as CreateEntryRequest
}

function paste(input: HTMLElement, text: string) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } })
}

describe('TotpSection in EntryFormDialog', () => {
  beforeEach(() => {
    useTotpCapabilityStore.getState().clearAll()
  })

  describe('feature gate', () => {
    it('create: hidden while no listing of the database has been seen', () => {
      renderDialog({ rows: null })
      expect(sectionTitle()).not.toBeInTheDocument()
    })

    it('create: hidden when the listed rows have no totp key (older server)', () => {
      renderDialog({ rows: [row()] })
      expect(sectionTitle()).not.toBeInTheDocument()
      expect(useTotpCapabilityStore.getState().verdicts.db).toBe(false)
    })

    it('create: shown for a password entry once a listed row carries totp', () => {
      renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      expect(sectionTitle()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add one-time code' })).toBeInTheDocument()
      expect(useTotpCapabilityStore.getState().verdicts.db).toBe(true)
    })

    it.each(['identity', 'rdp', 'information'] as const)(
      'create: hidden for a %s entry even when the server supports it',
      (type) => {
        renderDialog({ rows: [row({ totp: { state: 'none' } })], defaultType: type })
        expect(sectionTitle()).not.toBeInTheDocument()
      },
    )

    it('create: remembers the verdict for the database after the listing is gone', () => {
      const first = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      first.unmount()
      renderDialog({ rows: null })
      expect(sectionTitle()).toBeInTheDocument()
    })

    it('edit: hidden when the loaded entry has no totp key (older server)', () => {
      renderDialog({ entry: detail() })
      expect(sectionTitle()).not.toBeInTheDocument()
    })

    it('edit: hidden when the entry type is not writable', () => {
      renderDialog({ entry: detail({ type: 'rdp', totp: { ...STORED, writable: false } }) })
      expect(sectionTitle()).not.toBeInTheDocument()
    })

    it('edit: hidden when the entry may not be read', () => {
      renderDialog({ entry: detail({ totp: { state: 'hidden' } }) })
      expect(sectionTitle()).not.toBeInTheDocument()
    })

    it('edit: hidden for a totp.state it does not recognise (treated as hidden)', () => {
      renderDialog({ entry: detail({ totp: { state: 'future', writable: true } }) })
      expect(sectionTitle()).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Add one-time code' })).not.toBeInTheDocument()
    })

    it('edit: offers to add a code to an entry without one', () => {
      renderDialog({ entry: detail({ totp: { state: 'none', writable: true } }) })
      expect(screen.getByRole('button', { name: 'Add one-time code' })).toBeInTheDocument()
    })
  })

  describe('request body', () => {
    it('untouched: the key is absent from the submitted body', async () => {
      const { submit } = renderDialog({ entry: detail({ totp: STORED }) })
      expect(screen.getByText('SHA1 · 6 digits · every 30 s')).toBeInTheDocument()
      await submitForm(true)
      expect(submittedBody(submit)).not.toHaveProperty('totp')
    })

    it('remove: sends null only after the confirmation, and never on cancel', async () => {
      const { submit } = renderDialog({ entry: detail({ totp: STORED }) })
      fireEvent.click(screen.getByRole('button', { name: 'Remove one-time code' }))
      let confirm = screen
        .getByText(/The secret is deleted from the server when you save/)
        .closest('[role="dialog"]') as HTMLElement
      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByText('SHA1 · 6 digits · every 30 s')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Remove one-time code' }))
      confirm = screen
        .getByText(/The secret is deleted from the server when you save/)
        .closest('[role="dialog"]') as HTMLElement
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove one-time code' }))
      expect(
        screen.getByText('The one-time code will be removed when you save.'),
      ).toBeInTheDocument()

      await submitForm(true)
      expect(submittedBody(submit).totp).toBeNull()
    })

    it('remove: "Keep" returns to untouched', async () => {
      const { submit } = renderDialog({ entry: detail({ totp: STORED }) })
      fireEvent.click(screen.getByRole('button', { name: 'Remove one-time code' }))
      const confirm = screen
        .getByText(/The secret is deleted from the server when you save/)
        .closest('[role="dialog"]') as HTMLElement
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove one-time code' }))
      fireEvent.click(screen.getByRole('button', { name: 'Keep one-time code' }))
      await submitForm(true)
      expect(submittedBody(submit)).not.toHaveProperty('totp')
    })

    it('replace with only a parameter change sends the parameters without a secret', async () => {
      const { submit } = renderDialog({ entry: detail({ totp: STORED }) })
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      expect(screen.getByLabelText('Secret')).toHaveValue('')
      fireEvent.change(screen.getByLabelText('Digits'), { target: { value: '8' } })
      await submitForm(true)
      const body = submittedBody(submit)
      expect(body.totp).toEqual({ algorithm: 'SHA1', digits: 8, period: 30 })
      expect(body.totp).not.toHaveProperty('secret')
    })

    it('replace with nothing changed omits the key', async () => {
      const { submit } = renderDialog({ entry: detail({ totp: STORED }) })
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      await submitForm(true)
      expect(submittedBody(submit)).not.toHaveProperty('totp')
    })

    it('never sends an empty string as the secret', async () => {
      const { submit } = renderDialog({ entry: detail({ totp: STORED }) })
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: '   ' } })
      fireEvent.change(screen.getByLabelText('Period (seconds)'), { target: { value: '60' } })
      await submitForm(true)
      const body = submittedBody(submit)
      expect(body.totp).toEqual({ algorithm: 'SHA1', digits: 6, period: 60 })
      expect(JSON.stringify(body)).not.toContain('"secret"')
    })

    it('create with a typed secret sends all four members, normalised', async () => {
      const { submit } = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      fireEvent.change(screen.getByLabelText('Secret'), {
        target: { value: 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq' },
      })
      fireEvent.change(screen.getByLabelText('Algorithm'), { target: { value: 'SHA256' } })
      await submitForm(false)
      expect(submittedBody(submit).totp).toEqual({
        secret: SEED,
        algorithm: 'SHA256',
        digits: 6,
        period: 30,
      })
    })

    it('"Discard changes" drops a typed secret and omits the key', async () => {
      const { submit } = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: SEED } })
      fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
      expect(screen.queryByLabelText('Secret')).not.toBeInTheDocument()
      await submitForm(false)
      expect(submittedBody(submit)).not.toHaveProperty('totp')
    })
  })

  describe('otpauth paste', () => {
    it('fills the secret and locks the parameters to the link', async () => {
      const { submit } = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      paste(
        screen.getByLabelText('Setup link or secret'),
        `otpauth://totp/Example:alice%40example.com?secret=${SEED}&issuer=Example&algorithm=SHA256&digits=8&period=60`,
      )
      expect(screen.getByLabelText('Secret')).toHaveValue(SEED)
      expect(screen.getByLabelText('Algorithm')).toHaveValue('SHA256')
      expect(screen.getByLabelText('Algorithm')).toBeDisabled()
      expect(screen.getByLabelText('Digits')).toHaveValue('8')
      expect(screen.getByLabelText('Digits')).toBeDisabled()
      expect(screen.getByLabelText('Period (seconds)')).toHaveValue('60')
      expect(screen.getByLabelText('Period (seconds)')).toBeDisabled()
      expect(
        screen.getByText('Filled from the link for Example – alice@example.com.'),
      ).toBeInTheDocument()
      // The link itself is not kept anywhere on screen.
      expect(screen.getByLabelText('Setup link or secret')).toHaveValue('')

      await submitForm(false)
      expect(submittedBody(submit).totp).toEqual({
        secret: SEED,
        algorithm: 'SHA256',
        digits: 8,
        period: 60,
      })
    })

    it('a link without parameters fills the server defaults', () => {
      renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      paste(screen.getByLabelText('Setup link or secret'), `otpauth://totp/alice?secret=${SEED}`)
      expect(screen.getByLabelText('Algorithm')).toHaveValue('SHA1')
      expect(screen.getByLabelText('Digits')).toHaveValue('6')
      expect(screen.getByLabelText('Period (seconds)')).toHaveValue('30')
    })

    it('a link with parameters outside the accepted range leaves them editable and named on save', async () => {
      const { submit } = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      paste(
        screen.getByLabelText('Setup link or secret'),
        `otpauth://totp/alice?secret=${SEED}&digits=10`,
      )
      expect(screen.getByLabelText('Secret')).toHaveValue(SEED)
      expect(screen.getByLabelText('Digits')).toHaveValue('10')
      expect(screen.getByLabelText('Digits')).toBeEnabled()
      expect(screen.getByLabelText('Period (seconds)')).toBeEnabled()

      await submitForm(false)
      expect(submit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('A one-time code has 6 to 8 digits.')
      expect(screen.getByLabelText('Digits')).toHaveAttribute('aria-invalid', 'true')
    })

    it('editing the secret by hand unlocks the parameters again', () => {
      renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      paste(screen.getByLabelText('Setup link or secret'), `otpauth://totp/alice?secret=${SEED}`)
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: SEED.slice(0, 16) } })
      expect(screen.getByLabelText('Digits')).toBeEnabled()
    })

    it('a pasted bare secret goes to the secret field', () => {
      renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      paste(screen.getByLabelText('Setup link or secret'), 'jbsw y3dp ehpk 3pxp')
      expect(screen.getByLabelText('Secret')).toHaveValue('jbsw y3dp ehpk 3pxp')
      expect(screen.getByLabelText('Digits')).toBeEnabled()
    })

    it('a typed value is applied on Enter without submitting the form', async () => {
      const { submit } = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      const field = screen.getByLabelText('Setup link or secret')
      fireEvent.change(field, { target: { value: `otpauth://totp/alice?secret=${SEED}` } })
      await act(async () => {
        fireEvent.keyDown(field, { key: 'Enter' })
        await Promise.resolve()
      })
      expect(screen.getByLabelText('Secret')).toHaveValue(SEED)
      expect(submit).not.toHaveBeenCalled()
    })

    it.each([
      ['a counter-based link', `otpauth://hotp/alice?secret=${SEED}&counter=1`],
      ['a migration export', 'otpauth-migration://offline?data=CjEKCkhlbGxvIQ'],
      ['an unknown algorithm', `otpauth://totp/alice?secret=${SEED}&algorithm=MD5`],
    ])('refuses %s and leaves the secret empty', (_what, uri) => {
      renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      paste(screen.getByLabelText('Setup link or secret'), uri)
      expect(screen.getByText(/The pasted link could not be read/)).toBeInTheDocument()
      expect(screen.getByLabelText('Secret')).toHaveValue('')
    })
  })

  describe('validation and refusals', () => {
    it('a secret that is not Base32 is refused before anything is sent', async () => {
      const { submit } = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 'JBSW1Y3DPEHPK3PXP' } })
      await submitForm(false)
      expect(submit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The secret must be 16 to 128 Base32 characters (A–Z, 2–7).',
      )
      expect(screen.getByLabelText('Secret')).toHaveAttribute('aria-invalid', 'true')
    })

    it('an out-of-range period is named before submit', async () => {
      const { submit } = renderDialog({ rows: [row({ totp: { state: 'none' } })] })
      fireEvent.click(screen.getByRole('button', { name: 'Add one-time code' }))
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: SEED } })
      fireEvent.change(screen.getByLabelText('Period (seconds)'), { target: { value: '121' } })
      await submitForm(false)
      expect(submit).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('The period must be 15 to 120 seconds.')
      expect(screen.getByLabelText('Period (seconds)')).toHaveAttribute('aria-invalid', 'true')
    })

    it('a server refusal is shown at the field in the browser language, never the server text', async () => {
      const { submit, onClose } = renderDialog({
        entry: detail({ totp: STORED }),
        onSubmit: () => Promise.reject(new ApiError(400, 4003, 'Server-side wording')),
      })
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      fireEvent.change(screen.getByLabelText('Digits'), { target: { value: '8' } })
      await submitForm(true)
      expect(submit).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('alert')).toHaveTextContent('A one-time code has 6 to 8 digits.')
      expect(screen.getByRole('alert')).not.toHaveTextContent('Server-side wording')
      expect(screen.getByLabelText('Digits')).toHaveAttribute('aria-invalid', 'true')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('a 4001 to a parameter-only change names the stored secret, not the empty input', async () => {
      const { submit } = renderDialog({
        entry: detail({ totp: STORED }),
        onSubmit: () => Promise.reject(new ApiError(400, 4001, 'Server-side wording')),
      })
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      fireEvent.change(screen.getByLabelText('Digits'), { target: { value: '8' } })
      await submitForm(true)
      expect(submittedBody(submit).totp).not.toHaveProperty('secret')
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The stored secret does not produce a code. Enter a new secret to replace it.',
      )
      expect(screen.getByRole('alert')).not.toHaveTextContent('Server-side wording')
      expect(screen.getByLabelText('Secret')).toHaveAttribute('aria-invalid', 'true')
    })

    it('a 4001 to a sent secret names the secret rule', async () => {
      renderDialog({
        entry: detail({ totp: STORED }),
        onSubmit: () => Promise.reject(new ApiError(400, 4001, 'Server-side wording')),
      })
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      fireEvent.change(screen.getByLabelText('Secret'), { target: { value: SEED } })
      await submitForm(true)
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The secret must be 16 to 128 Base32 characters (A–Z, 2–7).',
      )
      expect(screen.getByLabelText('Secret')).toHaveAttribute('aria-invalid', 'true')
    })

    it('a missing read permission (403/4033) is explained inline', async () => {
      renderDialog({
        entry: detail({ totp: STORED }),
        onSubmit: () => Promise.reject(new ApiError(403, 4033, 'Server-side wording')),
      })
      fireEvent.click(screen.getByRole('button', { name: 'Remove one-time code' }))
      const confirm = screen
        .getByText(/The secret is deleted from the server when you save/)
        .closest('[role="dialog"]') as HTMLElement
      fireEvent.click(within(confirm).getByRole('button', { name: 'Remove one-time code' }))
      await submitForm(true)
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You need read permission on this entry to change its one-time code.',
      )
    })

    it('other failures are left to the toast (no inline message)', async () => {
      renderDialog({
        entry: detail({ totp: STORED }),
        onSubmit: () => Promise.reject(new ApiError(403, 403, 'Forbidden')),
      })
      await submitForm(true)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('stored settings', () => {
    it('shows an unknown algorithm as such', () => {
      renderDialog({ entry: detail({ totp: { ...STORED, algorithm: null } }) })
      expect(screen.getByText('unknown algorithm · 6 digits · every 30 s')).toBeInTheDocument()
    })

    it('warns when the stored secret produces no code', () => {
      renderDialog({ entry: detail({ totp: { ...STORED, state: 'invalid', conforming: false } }) })
      expect(screen.getByText(/The stored secret does not produce a code/)).toBeInTheDocument()
    })

    it('warns about non-conforming settings and pulls them into range on replace', () => {
      renderDialog({
        entry: detail({
          totp: { ...STORED, digits: 12, period: 300, algorithm: null, conforming: false },
        }),
      })
      expect(screen.getByText('unknown algorithm · 12 digits · every 300 s')).toBeInTheDocument()
      expect(screen.getByText(/Saving forces them into range/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      expect(screen.getByLabelText('Algorithm')).toHaveValue('SHA1')
      expect(screen.getByLabelText('Digits')).toHaveValue('8')
      expect(screen.getByLabelText('Period (seconds)')).toHaveValue('120')
      expect(screen.getByText(/Saving forces them into range/)).toBeInTheDocument()
    })

    it('the secret input is never pre-filled and its toggle reveals only what was typed', () => {
      renderDialog({ entry: detail({ totp: STORED }) })
      fireEvent.click(screen.getByRole('button', { name: 'Replace one-time code' }))
      const secret = screen.getByLabelText('Secret')
      expect(secret).toHaveValue('')
      expect(secret).toHaveAttribute('type', 'password')
      expect(secret).toHaveAttribute('placeholder', 'Leave empty to keep the current secret')
      fireEvent.click(screen.getByRole('button', { name: 'Show secret' }))
      expect(secret).toHaveAttribute('type', 'text')
      fireEvent.click(screen.getByRole('button', { name: 'Hide secret' }))
      expect(secret).toHaveAttribute('type', 'password')
    })
  })
})
