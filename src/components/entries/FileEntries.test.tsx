import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/i18n'
import { EntryList } from './EntryList'
import { EntryDetail as EntryDetailView } from './EntryDetail'
import { EntryTypeRouter } from './EntryTypeRouter'
import { EntryFormDialog } from './EntryFormDialog'
import { CreateMenu } from '@/components/common/CreateMenu'
import { downloadDocument, uploadDocument, getEntry } from '@/api/entries'
import { ApiError } from '@/api/client'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import { useToastStore } from '@/stores/toastStore'
import type { EntryDetail } from '@/api/types'

vi.mock('@/api/entries', async (original) => ({
  ...(await original<typeof import('@/api/entries')>()),
  getEntry: vi.fn(),
  downloadDocument: vi.fn(),
  uploadDocument: vi.fn(),
}))

const download = vi.mocked(downloadDocument)
const upload = vi.mocked(uploadDocument)
let queryClient: QueryClient
const NativeURL = URL

function entry(extra: Partial<EntryDetail> = {}): EntryDetail {
  return {
    id: 'cert',
    name: 'Site certificate',
    type: 'certificate',
    path: [],
    has_second_pass: false,
    has_otp: false,
    updated_at: '2026-09-25T00:00:00Z',
    certificate: {
      pass: 'stored-secret',
      public_key: { name: 'site.pem', type: 'PEM', size: 0 },
      private_key: null,
      subject: 'CN=example.test',
      issuer: 'CN=Example CA',
      valid_from: '2026-01-01T00:00:00Z',
      valid_to: '2027-01-01T00:00:00Z',
      thumbprint: 'AABBCC',
    },
    ...extra,
  }
}
function mount(view: React.ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{view}</QueryClientProvider>)
}
function form(data: EntryDetail) {
  const submit = vi.fn().mockResolvedValue(undefined)
  mount(
    <EntryFormDialog open onClose={vi.fn()} entry={data} onSubmit={submit} isSubmitting={false} />,
  )
  return submit
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.clearAllMocks()
  vi.mocked(getEntry).mockReset()
  download.mockReset()
  upload.mockReset()
  useNavigationStore.getState().setDatabase('db')
  useSecondPasswordStore.getState().clearAll()
  useToastStore.setState({ toasts: [] })
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:synthetic')
      static revokeObjectURL = vi.fn()
    },
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  queryClient.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('certificate entries', () => {
  it('shows derived metadata read-only and masks the certificate password', () => {
    mount(<EntryTypeRouter entry={entry()} />)
    expect(screen.getByText('CN=example.test')).toBeInTheDocument()
    expect(screen.getByText('CN=Example CA')).toBeInTheDocument()
    expect(screen.getByText('AABBCC')).toBeInTheDocument()
    expect(screen.getByText('0 B')).toBeInTheDocument()
    expect(screen.queryByText('stored-secret')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal value' }))
    expect(screen.getByText('stored-secret')).toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads the selected slot only after confirmation and forwards the unlocked second password', async () => {
    useSecondPasswordStore.getState().setSecondPassword('cert', 'second-secret')
    download.mockResolvedValue({ blob: new Blob(['certificate']), filename: 'server.pem' })
    mount(<EntryTypeRouter entry={entry()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download Public certificate' }))
    expect(download).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Download$/ })))
    expect(download).toHaveBeenCalledWith('db', 'cert', 'second-secret', 'public')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic')
  })

  it('uploads a private attachment without replacing or deleting the public one', async () => {
    upload.mockResolvedValue({
      id: 'cert',
      name: 'Site certificate',
      type: 'certificate',
      has_second_pass: false,
      updated_at: '',
    })
    useSecondPasswordStore.getState().setSecondPassword('cert', 'second-secret')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    mount(<EntryTypeRouter entry={entry()} />)
    const file = new File(['private bytes'], 'secret.key')
    await act(async () =>
      fireEvent.change(screen.getByLabelText('Upload Private key'), { target: { files: [file] } }),
    )
    expect(upload).toHaveBeenCalledWith(
      'db',
      'cert',
      file,
      expect.objectContaining({ part: 'private', secondPassword: 'second-secret' }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entry', 'db', 'cert'] })
    expect(screen.getByText('site.pem')).toBeInTheDocument()
  })

  it('reports an upload refusal while retaining the existing attachment', async () => {
    upload.mockRejectedValue(new ApiError(403, 403, 'Access denied'))
    mount(<EntryTypeRouter entry={entry()} />)
    await act(async () =>
      fireEvent.change(screen.getByLabelText('Replace Public certificate'), {
        target: { files: [new File(['new'], 'new.pem')] },
      }),
    )
    expect(screen.getByText('site.pem')).toBeInTheDocument()
    expect(useToastStore.getState().toasts[0]?.message).toBe('Access denied')
  })

  it('shows no attachment actions when the server withholds certificate details', () => {
    mount(<EntryTypeRouter entry={entry({ certificate: undefined })} />)
    expect(screen.queryByText('stored-secret')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Upload Private key')).not.toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('edits the password without echoing derived metadata or attachment descriptors', async () => {
    const submit = form(entry())
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0].certificate).toEqual({ pass: 'new-secret' })
    expect(submit.mock.calls[0][0]).not.toHaveProperty('type')
    expect(submit.mock.calls[0][0]).not.toHaveProperty('totp')
  })

  it('does not clear a hidden or untouched password when saving common metadata', async () => {
    const submit = form(entry({ certificate: undefined }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).not.toHaveProperty('certificate')
  })
})

describe('encrypted file references', () => {
  function encrypted(): EntryDetail {
    return entry({
      type: 'encrypted_file',
      certificate: undefined,
      encrypted_file: {
        pass: 'file-secret',
        files: [{ name: 'backup.pwde', path: 'C:/private' }],
      },
    })
  }
  it('renders paths as text with no file-transfer actions or navigable links', () => {
    mount(<EntryTypeRouter entry={encrypted()} />)
    expect(screen.getByText('C:/private')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('file-secret')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /download|upload/i })).not.toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })
  it('sends only the changed references and supports removing the final reference', async () => {
    const submit = form(encrypted())
    fireEvent.click(screen.getByRole('button', { name: 'Remove reference' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0].encrypted_file).toEqual({ files: [] })
  })
  it('creates a reference entry without uploading or opening its paths', async () => {
    const submit = vi.fn().mockResolvedValue(undefined)
    mount(
      <EntryFormDialog
        open
        onClose={vi.fn()}
        defaultType="encrypted_file"
        onSubmit={submit}
        isSubmitting={false}
      />,
    )
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Archive' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add reference' }))
    fireEvent.change(screen.getByLabelText('File Name'), { target: { value: 'archive.pwde' } })
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'C:/archives' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).toMatchObject({
      type: 'encrypted_file',
      encrypted_file: { files: [{ name: 'archive.pwde', path: 'C:/archives' }] },
    })
    expect(upload).not.toHaveBeenCalled()
  })
})

it.each([
  ['Certificate', 'certificate'],
  ['Encrypted File', 'encrypted_file'],
] as const)('routes New %s to the entry form rather than document upload', async (label, type) => {
  const newEntry = vi.fn()
  const newDocument = vi.fn()
  mount(<CreateMenu onNewFolder={vi.fn()} onNewEntry={newEntry} onNewDocument={newDocument} />)
  fireEvent.click(screen.getByRole('button', { name: 'New' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: label }))
  expect(newEntry).toHaveBeenCalledWith(type)
  expect(newDocument).not.toHaveBeenCalled()
})

it('lists both new types with names and icons, without an OTP badge', () => {
  const select = vi.fn()
  mount(
    <EntryList
      items={[
        entry(),
        entry({
          id: 'refs',
          type: 'encrypted_file',
          name: 'Local references',
          certificate: undefined,
        }),
      ]}
      selectedEntryId={null}
      onFolderClick={vi.fn()}
      onEntryClick={select}
    />,
  )
  expect(screen.getByText('Certificate')).toBeInTheDocument()
  expect(screen.getByText('Encrypted File')).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: 'Has a one-time code' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Local references/ }))
  expect(select).toHaveBeenCalledWith('refs')
})

it('clears a rejected second password after a private-content read refusal', async () => {
  useSecondPasswordStore.getState().setSecondPassword('cert', 'expired')
  download.mockRejectedValue(new ApiError(403, 4031, 'Invalid second password'))
  mount(
    <EntryTypeRouter
      entry={entry({ certificate: { private_key: { name: 'private.key', size: 12 } } })}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Download Private key' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Download$/ })))
  expect(download).toHaveBeenCalledWith('db', 'cert', 'expired', 'private')
  expect(useSecondPasswordStore.getState().getSecondPassword('cert')).toBeUndefined()
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
})

it('keeps the second password on a permissions refusal but clears it on 4031', async () => {
  useSecondPasswordStore.getState().setSecondPassword('cert', 'second-secret')
  upload.mockRejectedValueOnce(new ApiError(403, 403, 'Read-only'))
  upload.mockRejectedValueOnce(new ApiError(403, 4031, 'Invalid second password'))
  mount(<EntryTypeRouter entry={entry()} />)
  const file = new File(['secret'], 'private.key')
  await act(async () =>
    fireEvent.change(screen.getByLabelText('Upload Private key'), { target: { files: [file] } }),
  )
  expect(useSecondPasswordStore.getState().getSecondPassword('cert')).toBe('second-secret')
  await act(async () =>
    fireEvent.change(screen.getByLabelText('Upload Private key'), { target: { files: [file] } }),
  )
  expect(useSecondPasswordStore.getState().getSecondPassword('cert')).toBeUndefined()
  expect(screen.getByText('site.pem')).toBeInTheDocument()
})

it('aborts an in-flight attachment upload on unmount without showing a late toast', async () => {
  let signal: AbortSignal | undefined
  upload.mockImplementationOnce(
    (_db, _id, _file, options) =>
      new Promise((_resolve, reject) => {
        signal = options?.signal
        signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
      }),
  )
  const view = mount(<EntryTypeRouter entry={entry()} />)
  fireEvent.change(screen.getByLabelText('Upload Private key'), {
    target: { files: [new File(['bytes'], 'private.key')] },
  })
  expect(signal?.aborted).toBe(false)
  await act(async () => view.unmount())
  expect(signal?.aborted).toBe(true)
  expect(useToastStore.getState().toasts).toHaveLength(0)
})

it('discards a late download after the selected entry is unmounted', async () => {
  let complete!: (data: { blob: Blob; filename: string }) => void
  download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const view = mount(<EntryTypeRouter entry={entry()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Download Public certificate' }))
  fireEvent.click(screen.getByRole('button', { name: /^Download$/ }))
  view.unmount()
  await act(async () => complete({ blob: new Blob(['secret']), filename: 'late.pem' }))
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('does not offer attachment replacement on a linked certificate', () => {
  mount(<EntryTypeRouter entry={entry({ is_link: true })} />)
  expect(screen.getByRole('button', { name: 'Download Public certificate' })).toBeInTheDocument()
  expect(screen.queryByLabelText('Replace Public certificate')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Upload Private key')).not.toBeInTheDocument()
})

it.each(['certificate', 'encrypted_file'] as const)(
  'keeps linked %s fields read-only while allowing common metadata edits',
  async (type) => {
    const submit = form(
      entry({
        type,
        is_link: true,
        encrypted_file: {
          pass: 'file-secret',
          files: [{ name: 'backup.pwde', path: 'C:/private' }],
        },
      }),
    )
    expect(screen.getByLabelText('Password')).toBeDisabled()
    if (type === 'encrypted_file') {
      expect(screen.getByLabelText('File Name')).toBeDisabled()
      expect(screen.getByLabelText('Folder')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove reference' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Add reference' })).not.toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0]).not.toHaveProperty(type)
  },
)

it.each([false, true])(
  'invalidates a committed upload after unmount without reviving a cleared logout cache (cleared: %s)',
  async (clearCache) => {
    const keys = [
      ['entry', 'db', 'cert'],
      ['children', 'db'],
      ['search', 'db'],
    ]
    for (const key of keys) queryClient.setQueryData(key, { cached: true })
    queryClient.setQueryData(['entry', 'other-db', 'unrelated'], { cached: true })
    let complete!: (value: Awaited<ReturnType<typeof uploadDocument>>) => void
    let signal: AbortSignal | undefined
    // The server may have committed before abort: the transfer can still settle successfully.
    upload.mockImplementationOnce(
      (_db, _entry, _file, options) =>
        new Promise((resolve) => {
          signal = options?.signal
          complete = resolve
        }),
    )
    const view = mount(<EntryTypeRouter entry={entry()} />)
    fireEvent.change(screen.getByLabelText('Upload Private key'), {
      target: { files: [new File(['bytes'], 'private.key')] },
    })
    view.unmount()
    expect(signal?.aborted).toBe(true)
    useNavigationStore.getState().setDatabase('other-db')
    if (clearCache) queryClient.clear()
    await act(async () => complete(entry()))
    if (clearCache) {
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    } else {
      for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(['entry', 'other-db', 'unrelated'])?.isInvalidated).toBe(
        false,
      )
    }
    expect(useToastStore.getState().toasts).toHaveLength(0)
  },
)

it('prompts for a linked certificate target password on 4031 and asks again after its cached password is cleared', async () => {
  const linked = entry({ is_link: true, linked_item: 'target' })
  vi.mocked(getEntry).mockImplementation(async (_db, _id, second) => {
    if (second !== 'target-password') throw new ApiError(403, 4031, 'Invalid second password')
    return linked
  })
  mount(
    <EntryDetailView
      dbId="db"
      compactEntry={linked}
      onEdit={vi.fn()}
      onMove={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(linked.has_second_pass).toBe(false)
  await screen.findByRole('dialog', { name: 'Second Password Required' })
  fireEvent.change(screen.getByLabelText('Second Password'), {
    target: { value: 'target-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  await screen.findByText('CN=example.test')
  expect(useSecondPasswordStore.getState().getSecondPassword('cert')).toBe('target-password')
  // A later /content refusal clears that password. The requirement must survive it.
  download.mockRejectedValueOnce(new ApiError(403, 4031, 'Invalid second password'))
  fireEvent.click(screen.getByRole('button', { name: 'Download Public certificate' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Download$/ })))
  expect(
    await screen.findByRole('dialog', { name: 'Second Password Required' }),
  ).toBeInTheDocument()
  expect(useSecondPasswordStore.getState().getSecondPassword('cert')).toBeUndefined()
  expect(screen.queryByText('CN=example.test')).not.toBeInTheDocument()
})

it('does not turn a plain certificate permission refusal into a password prompt', async () => {
  vi.mocked(getEntry).mockRejectedValue(new ApiError(403, 403, 'Access denied'))
  mount(
    <EntryDetailView
      dbId="db"
      compactEntry={entry({ is_link: true })}
      onEdit={vi.fn()}
      onMove={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  await screen.findByText('Access denied')
  expect(screen.queryByRole('dialog', { name: 'Second Password Required' })).not.toBeInTheDocument()
})
