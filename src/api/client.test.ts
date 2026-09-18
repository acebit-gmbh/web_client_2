import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  apiClient,
  ApiError,
  configureApi,
  buildAuthHeaders,
  getServerOrigin,
  type ApiBindings,
} from './client'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function emptyResponse(status: number): Response {
  return new Response(null, { status })
}

describe('apiClient', () => {
  let onActivity: ApiBindings['onActivity'] & { mock: { calls: unknown[][] } }
  let onAuthFailure: ApiBindings['onAuthFailure'] & { mock: { calls: unknown[][] } }
  let getContext: ApiBindings['getContext']
  let fetchMock: ReturnType<typeof vi.fn>

  function setupBindings(overrides: Partial<ReturnType<ApiBindings['getContext']>> = {}) {
    onActivity = vi.fn() as typeof onActivity
    onAuthFailure = vi.fn() as typeof onAuthFailure
    getContext = vi.fn(() => ({
      serverOrigin: 'https://pd.example.com:8714' as string,
      token: 'test-token' as string | null,
      ...overrides,
    })) as ApiBindings['getContext']
    configureApi({ getContext, onActivity, onAuthFailure })
  }

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setupBindings()
  })

  describe('URL construction', () => {
    it('prefixes endpoints with serverOrigin + /v2.0', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/me')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://pd.example.com:8714/v2.0/me',
        expect.any(Object),
      )
    })

    it('uses bare /v2.0 prefix for bundled mode (empty origin)', async () => {
      setupBindings({ serverOrigin: '', token: 't' })
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/databases')
      expect(fetchMock).toHaveBeenCalledWith('/v2.0/databases', expect.any(Object))
    })
  })

  describe('Authorization header', () => {
    it('attaches Bearer token from bindings', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/me')
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      expect(headers.get('Authorization')).toBe('Bearer test-token')
    })

    it('omits Authorization when no token', async () => {
      setupBindings({ serverOrigin: 'https://pd.example.com:8714', token: null })
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/auth/oidc')
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      expect(headers.get('Authorization')).toBeNull()
    })

    it('honors skipAuth even when a token is set', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/auth/login', { method: 'POST', body: '{}', skipAuth: true })
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      expect(headers.get('Authorization')).toBeNull()
    })
  })

  describe('X-Second-Password header', () => {
    it('Base64-encodes the second password when provided', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/databases/x/entries/y', { secondPassword: 'sekret' })
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      // toBase64('sekret') === btoa('sekret')
      expect(headers.get('X-Second-Password')).toBe(btoa('sekret'))
    })

    it('handles non-ASCII via UTF-8 encoding (not raw btoa)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/x', { secondPassword: 'pässwörd' })
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      const sent = headers.get('X-Second-Password')!
      // Round-trip through atob + TextDecoder should give us the original.
      const bytes = Uint8Array.from(atob(sent), (c) => c.charCodeAt(0))
      expect(new TextDecoder().decode(bytes)).toBe('pässwörd')
    })

    it('does not set the header when secondPassword is omitted', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/x')
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      expect(headers.get('X-Second-Password')).toBeNull()
    })
  })

  describe('Content-Type defaulting', () => {
    it('sets application/json when a body is sent and no Content-Type is provided', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/x', { method: 'POST', body: JSON.stringify({ a: 1 }) })
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      expect(headers.get('Content-Type')).toBe('application/json')
    })

    it('does not override an explicit Content-Type', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/x', {
        method: 'POST',
        body: 'binary-blob',
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      expect(headers.get('Content-Type')).toBe('application/octet-stream')
    })

    it('omits Content-Type when no body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/x')
      const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers
      expect(headers.get('Content-Type')).toBeNull()
    })
  })

  describe('Successful responses', () => {
    it('parses JSON response bodies', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ value: 42 }))
      const result = await apiClient<{ value: number }>('/x')
      expect(result).toEqual({ value: 42 })
    })

    it('returns undefined for 204 No Content', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(204))
      const result = await apiClient('/x', { method: 'DELETE' })
      expect(result).toBeUndefined()
    })

    it('calls onActivity (resets session watchdog) on success', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/x')
      expect(onActivity).toHaveBeenCalledTimes(1)
    })

    it('does NOT call onActivity on success when skipActivity is set', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ value: 42 }))
      const result = await apiClient<{ value: number }>('/x', { skipActivity: true })
      expect(result).toEqual({ value: 42 })
      expect(onActivity).not.toHaveBeenCalled()
    })

    it('does not pass skipActivity on to fetch, and keeps auth and no-store', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
      await apiClient('/x', { skipActivity: true })
      const init = fetchMock.mock.calls[0][1] as RequestInit
      expect(init).not.toHaveProperty('skipActivity')
      expect(init.cache).toBe('no-store')
      expect((init.headers as Headers).get('Authorization')).toBe('Bearer test-token')
    })
  })

  describe('Error responses', () => {
    it('throws ApiError with code/message from server JSON body', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: 460, message: 'Enter your TFA code' } }, { status: 460 }),
      )
      await expect(apiClient('/auth/login', { method: 'POST', body: '{}', skipAuth: true }))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 460,
          code: 460,
          message: 'Enter your TFA code',
        })
    })

    it('falls back to status text when error body is not JSON', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('not json', { status: 502, statusText: 'Bad Gateway' }),
      )
      await expect(apiClient('/x')).rejects.toMatchObject({
        status: 502,
        message: 'Bad Gateway',
      })
    })

    it('does NOT call onActivity on failure', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(500))
      await expect(apiClient('/x')).rejects.toBeInstanceOf(ApiError)
      expect(onActivity).not.toHaveBeenCalled()
    })

    it('triggers onAuthFailure on 401', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(401))
      await expect(apiClient('/me')).rejects.toBeInstanceOf(ApiError)
      expect(onAuthFailure).toHaveBeenCalledTimes(1)
    })

    it('skipActivity changes nothing about errors: 401 still logs out, the code is still parsed', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(401))
      await expect(apiClient('/x', { skipActivity: true })).rejects.toBeInstanceOf(ApiError)
      expect(onAuthFailure).toHaveBeenCalledTimes(1)

      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: 4042, message: 'No such icon.' } }, { status: 404 }),
      )
      await expect(apiClient('/x', { skipActivity: true })).rejects.toMatchObject({
        status: 404,
        code: 4042,
      })
    })

    it('does NOT trigger onAuthFailure on 401 when skipAuth is set', async () => {
      // Login itself is 401-able without meaning "log out the existing session".
      fetchMock.mockResolvedValueOnce(emptyResponse(401))
      await expect(
        apiClient('/auth/login', { method: 'POST', body: '{}', skipAuth: true }),
      ).rejects.toBeInstanceOf(ApiError)
      expect(onAuthFailure).not.toHaveBeenCalled()
    })

    it('does NOT trigger onAuthFailure on 403 / 404 / 5xx', async () => {
      fetchMock.mockResolvedValueOnce(emptyResponse(403))
      await expect(apiClient('/x')).rejects.toBeInstanceOf(ApiError)
      fetchMock.mockResolvedValueOnce(emptyResponse(404))
      await expect(apiClient('/x')).rejects.toBeInstanceOf(ApiError)
      fetchMock.mockResolvedValueOnce(emptyResponse(500))
      await expect(apiClient('/x')).rejects.toBeInstanceOf(ApiError)
      expect(onAuthFailure).not.toHaveBeenCalled()
    })
  })
})

describe('helper exports', () => {
  beforeEach(() => {
    configureApi({
      getContext: () => ({ serverOrigin: 'https://h:1', token: 'tok' }),
      onActivity: () => {},
      onAuthFailure: () => {},
    })
  })

  it('buildAuthHeaders returns a Bearer header when a token is present', () => {
    expect(buildAuthHeaders()).toEqual({ Authorization: 'Bearer tok' })
  })

  it('buildAuthHeaders returns an empty object when no token', () => {
    configureApi({
      getContext: () => ({ serverOrigin: '', token: null }),
      onActivity: () => {},
      onAuthFailure: () => {},
    })
    expect(buildAuthHeaders()).toEqual({})
  })

  it('getServerOrigin reflects the configured binding', () => {
    expect(getServerOrigin()).toBe('https://h:1')
  })
})
