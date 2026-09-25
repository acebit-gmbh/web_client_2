import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiError, UploadInterruptedError, configureApi, type ApiBindings } from './client'
import { getEntryOtp, uploadDocument, downloadDocument } from './entries'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('getEntryOtp', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    configureApi({
      getContext: vi.fn(() => ({
        serverOrigin: 'https://pd.example.com:8714' as string,
        token: 'test-token' as string | null,
      })) as ApiBindings['getContext'],
      onActivity: vi.fn() as ApiBindings['onActivity'],
      onAuthFailure: vi.fn() as ApiBindings['onAuthFailure'],
    })
  })

  it('GETs the otp sub-resource of the entry', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: '012345', digits: 6, period: 30, expires_in: 12, algorithm: 'SHA1' }),
    )
    const otp = await getEntryOtp('d', 'e')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pd.example.com:8714/v2.0/databases/d/entries/e/otp',
      expect.any(Object),
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method ?? 'GET').toBe('GET')
    expect(otp.code).toBe('012345')
    expect(typeof otp.code).toBe('string')
  })

  it('sends X-Second-Password only when one is given', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: '1', digits: 6, period: 30, expires_in: 1, algorithm: 'SHA1' }),
    )
    await getEntryOtp('d', 'e', 'sekret')
    let headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
    expect(headers.get('X-Second-Password')).toBe(btoa('sekret'))

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: '1', digits: 6, period: 30, expires_in: 1, algorithm: 'SHA1' }),
    )
    await getEntryOtp('d', 'e')
    headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Headers
    expect(headers.get('X-Second-Password')).toBeNull()
  })

  it('surfaces "no one-time code" as ApiError 404 / 4041', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 4041, message: 'The entry specified has no one-time code.' } },
        { status: 404 },
      ),
    )
    const err = await getEntryOtp('d', 'e').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).code).toBe(4041)
  })

  it('keeps a wrong second password distinguishable as 403 / 4031', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 4031, message: 'Invalid second password.' } }, { status: 403 }),
    )
    const err = await getEntryOtp('d', 'e', 'wrong').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect((err as ApiError).code).toBe(4031)
  })
})

/** Minimal XMLHttpRequest stand-in: records what uploadDocument does and lets the test fire the outcome. */
class FakeXhr {
  static last: FakeXhr | null = null
  method = ''
  url = ''
  headers: Record<string, string> = {}
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  status = 0
  statusText = ''
  responseText = ''
  sent: unknown = undefined
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: unknown) {
    this.sent = body
  }
  abort() {
    this.onabort?.()
  }
}

describe('uploadDocument', () => {
  let onActivity: ReturnType<typeof vi.fn>

  beforeEach(() => {
    FakeXhr.last = null
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    onActivity = vi.fn()
    configureApi({
      getContext: vi.fn(() => ({
        serverOrigin: 'https://pd.example.com:8714' as string,
        token: 'test-token' as string | null,
      })) as ApiBindings['getContext'],
      onActivity: onActivity as ApiBindings['onActivity'],
      onAuthFailure: vi.fn() as ApiBindings['onAuthFailure'],
    })
  })

  const file = () => new File(['hello'], 'notes.txt', { type: 'text/plain' })

  it('PUTs the file to the content sub-resource with the bearer token', async () => {
    const upload = uploadDocument('d', 'e', file())
    const xhr = FakeXhr.last!
    expect(xhr.method).toBe('PUT')
    expect(xhr.url).toBe('https://pd.example.com:8714/v2.0/databases/d/entries/e/content')
    expect(xhr.headers.Authorization).toBe('Bearer test-token')
    expect(xhr.headers).not.toHaveProperty('X-PD-Client')
    expect(xhr.sent).toBeInstanceOf(File)

    xhr.status = 200
    xhr.responseText = JSON.stringify({ id: 'e', type: 'document', name: 'notes.txt' })
    xhr.onload!()
    await expect(upload).resolves.toMatchObject({ id: 'e' })
    expect(onActivity).toHaveBeenCalledTimes(1)
  })

  it('rejects with the typed UploadInterruptedError when the request never gets an answer', async () => {
    const upload = uploadDocument('d', 'e', file())
    FakeXhr.last!.onerror!()

    const err = await upload.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UploadInterruptedError)
    // Not a TypeError (that is fetch's "cannot reach the server") and not an ApiError.
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err).not.toBeInstanceOf(ApiError)
    expect(onActivity).not.toHaveBeenCalled()
  })

  it('still rejects an HTTP refusal as ApiError(status, code)', async () => {
    const upload = uploadDocument('d', 'e', file())
    const xhr = FakeXhr.last!
    xhr.status = 413
    xhr.statusText = 'Payload Too Large'
    xhr.responseText = JSON.stringify({ error: { code: 413, message: 'Too large.' } })
    xhr.onload!()

    const err = await upload.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(413)
  })

  it('rejects a cancelled upload as AbortError, not as an interruption', async () => {
    const controller = new AbortController()
    const upload = uploadDocument('d', 'e', file(), { signal: controller.signal })
    controller.abort()

    const err = await upload.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DOMException)
    expect((err as DOMException).name).toBe('AbortError')
  })
})

// ES-1003: binary transfers stay on /content and choose the certificate slot
// explicitly. No encrypted-file path is ever an HTTP request target.
describe('certificate content requests', () => {
  const fetchMock = vi.fn()
  const onActivity = vi.fn()
  const onAuthFailure = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    configureApi({
      getContext: () => ({ serverOrigin: '', token: 'test-token' }),
      onActivity,
      onAuthFailure,
    })
  })

  it.each(['public', 'private'] as const)(
    'downloads only the %s certificate slot with the second password',
    async (part) => {
      fetchMock.mockResolvedValueOnce(
        new Response('opaque bytes', {
          headers: { 'Content-Disposition': 'attachment; filename="key.pem"' },
        }),
      )
      const result = await downloadDocument('db', 'cert', 'secret', part)
      expect(result.filename).toBe('key.pem')
      expect(fetchMock).toHaveBeenCalledWith(
        `/v2.0/databases/db/entries/cert/content?part=${part}`,
        expect.objectContaining({
          cache: 'no-store',
          headers: { Authorization: 'Bearer test-token', 'X-Second-Password': btoa('secret') },
        }),
      )
      expect(onActivity).toHaveBeenCalledOnce()
    },
  )

  it('keeps document URLs unchanged and omits an absent second password', async () => {
    fetchMock.mockResolvedValueOnce(new Response('document'))
    await downloadDocument('db', 'doc')
    expect(fetchMock).toHaveBeenCalledWith(
      '/v2.0/databases/db/entries/doc/content',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    )
  })

  it('preserves a protected-content refusal and never treats it as a download', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 4031, message: 'Wrong second password' } }, { status: 403 }),
    )
    await expect(downloadDocument('db', 'cert', 'wrong', 'private')).rejects.toMatchObject({
      status: 403,
      code: 4031,
    })
    expect(onActivity).not.toHaveBeenCalled()
    expect(onAuthFailure).not.toHaveBeenCalled()
  })

  it.each(['public', 'private'] as const)(
    'uploads %s as opaque bytes without changing the other slot',
    async (part) => {
      const file = new File(['opaque bytes'], 'key.pem', { type: 'application/octet-stream' })
      const promise = uploadDocument('db', 'cert', file, { part, secondPassword: 'secret' })
      const xhr = FakeXhr.last!
      expect(xhr.url).toBe(`/v2.0/databases/db/entries/cert/content?part=${part}`)
      expect(xhr.headers['X-Second-Password']).toBe(btoa('secret'))
      expect(xhr.headers).not.toHaveProperty('X-PD-Client')
      expect(xhr.sent).toBe(file)
      xhr.status = 200
      xhr.responseText = JSON.stringify({ id: 'cert', type: 'certificate' })
      xhr.onload!()
      await expect(promise).resolves.toMatchObject({ type: 'certificate' })
    },
  )

  it('rejects an already-cancelled transfer without sending bytes', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      uploadDocument('db', 'cert', new File(['bytes'], 'key.pem'), {
        part: 'private',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeXhr.last!.sent).toBeUndefined()
  })
})

it('encodes a Unicode second password for binary downloads', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('bytes'))
  vi.stubGlobal('fetch', fetchMock)
  configureApi({
    getContext: () => ({ serverOrigin: '', token: null }),
    onActivity: vi.fn(),
    onAuthFailure: vi.fn(),
  })
  await downloadDocument('db', 'cert', 'päss', 'private')
  expect(fetchMock.mock.calls[0][1].headers['X-Second-Password']).toBe('cMOkc3M=')
})
