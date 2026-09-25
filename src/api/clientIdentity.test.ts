import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../../package.json?raw'
import { apiClient, configureApi } from './client'
import { getOidcProviders, login } from './auth'
import { webauthnBegin, webauthnComplete } from './webauthn'

const identity = {
  platform: 'web',
  version: (JSON.parse(packageJson) as { version: string }).version,
}
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ access_token: 'synthetic' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  configureApi({
    getContext: () => ({ serverOrigin: 'https://pd.example.test', token: 'existing-token' }),
    onActivity: vi.fn(),
    onAuthFailure: vi.fn(),
  })
})
afterEach(() => vi.unstubAllGlobals())

function request(index = 0): RequestInit {
  return fetchMock.mock.calls[index][1] as RequestInit
}

// Server 19 has a fixed CORS allowlist. Identity must not add a request header,
// even before authentication or on transports that bypass apiClient.
function expectNoIdentityHeader(init: RequestInit) {
  expect(new Headers(init.headers).has('X-PD-Client')).toBe(false)
}

describe('REST client identification', () => {
  it.each(['standard', 'sspi', 'negotiate', 'oidc', 'azure'] as const)(
    'identifies %s sign-in in JSON before any session exists',
    async (auth) => {
      const payload = { auth, user: 'synthetic-user', scope: 'client' as const }
      await login(payload)
      expect(fetchMock.mock.calls[0][0]).toBe('https://pd.example.test/v2.0/auth/login')
      const init = request()
      expectNoIdentityHeader(init)
      expect(new Headers(init.headers).has('Authorization')).toBe(false)
      expect(JSON.parse(init.body as string)).toEqual({ ...payload, client: identity })
      expect(payload).not.toHaveProperty('client')
      expect(init.credentials).toBe(auth === 'negotiate' ? 'include' : undefined)
    },
  )

  it('identifies default sign-in and preserves a submitted second-factor code', async () => {
    const payload = { user: 'synthetic-user', pass: 'synthetic-password', tfacode: '123456' }
    await login(payload)
    expect(JSON.parse(request().body as string)).toEqual({ ...payload, client: identity })
    expectNoIdentityHeader(request())
  })

  it('identifies WebAuthn begin and leaves the response tied to its challenge unchanged', async () => {
    const response = {
      session_id: 'session',
      id: 'credential',
      response: {
        authenticatorData: 'data',
        clientDataJSON: 'json',
        signature: 'signature',
        userHandle: null,
      },
    }
    await webauthnBegin('synthetic-user')
    await webauthnComplete(response)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://pd.example.test/v2.0/auth/webauthn/begin',
      'https://pd.example.test/v2.0/auth/webauthn/complete',
    ])
    expect(JSON.parse(request(0).body as string)).toEqual({
      user: 'synthetic-user',
      scope: 'client',
      client: identity,
    })
    expect(JSON.parse(request(1).body as string)).toEqual(response)
    for (const i of [0, 1]) {
      expectNoIdentityHeader(request(i))
      expect(new Headers(request(i).headers).has('Authorization')).toBe(false)
    }
  })

  it('keeps unauthenticated provider discovery compatible with older CORS allowlists', async () => {
    await getOidcProviders()
    expectNoIdentityHeader(request())
    expect(new Headers(request().headers).has('Authorization')).toBe(false)
    expect(request().body).toBeUndefined()
  })

  it('uses the bound session for protected background requests without a new header', async () => {
    await apiClient('/databases/db/icons/1', {
      skipActivity: true,
      headers: { Accept: 'application/json' },
    })
    const headers = new Headers(request().headers)
    expectNoIdentityHeader(request())
    expect(headers.get('Authorization')).toBe('Bearer existing-token')
    expect(headers.get('Accept')).toBe('application/json')
    expect(request().cache).toBe('no-store')
  })

  it('does not retry submitted credentials if sign-in is rejected', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 401, message: 'Rejected' },
        }),
        { status: 401 },
      ),
    )
    await expect(
      login({ user: 'synthetic-user', pass: 'synthetic-password' }),
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
