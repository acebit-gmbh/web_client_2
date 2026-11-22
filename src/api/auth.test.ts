import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiError, configureApi } from './client'
import { login } from './auth'
import { webauthnBegin, webauthnComplete } from './webauthn'

// The server's own texts of a server that refuses every request, and of a
// mirror that refuses a sign-in it answers normally (Server 20.0.0).
const REPLACED =
  'This server has been replaced by the primary server pd2.example.com. Connect to that server.'
const HANDING_OVER =
  'This server is handing over to its mirror. Connect to the new primary server when the handover is complete.'
const MIRROR_UNPAIRED =
  'This server is no longer a mirror of its primary server. Sign in on the primary server.'

function refusal(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function providers(): Response {
  return new Response(JSON.stringify({ data: [], total: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const STANDARD = { user: 'alice', pass: 'secret', auth: 'standard', scope: 'client' } as const

describe('a sign-in the browser could not send', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    configureApi({
      getContext: () => ({ serverOrigin: 'https://pd.example.com:8714', token: null }),
      onActivity: vi.fn(),
      onAuthFailure: vi.fn(),
    })
  })

  it("shows the server's text of a server that has been replaced", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(refusal(403, REPLACED))

    const err = await login(STANDARD).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(403)
    expect((err as ApiError).message).toBe(REPLACED)
  })

  it('asks with a request the browser sends without a preflight', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(refusal(403, REPLACED))

    await login(STANDARD).catch(() => undefined)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://pd.example.com:8714/v2.0/auth/oidc')
    expect(init.method).toBeUndefined()
    expect(init.body).toBeUndefined()
    const headers = new Headers(init.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.has('Content-Type')).toBe(false)
  })

  it("shows the server's text on a passkey sign-in too", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(refusal(403, HANDING_OVER))

    const err = await webauthnBegin('alice').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe(HANDING_OVER)
  })

  it('and on the second step of a passkey sign-in', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchMock.mockResolvedValueOnce(refusal(403, HANDING_OVER))

    const err = await webauthnComplete({
      session_id: 's',
      id: 'c',
      response: { authenticatorData: 'a', clientDataJSON: 'b', signature: 'c', userHandle: null },
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe(HANDING_OVER)
  })

  it('keeps the network error where the server answers the provider list', async () => {
    const network = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValueOnce(network)
    fetchMock.mockResolvedValueOnce(providers())

    await expect(login(STANDARD)).rejects.toBe(network)
  })

  it('keeps the network error where the provider list cannot be fetched either', async () => {
    const network = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValueOnce(network)
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(login(STANDARD)).rejects.toBe(network)
  })

  it('keeps the network error where the provider list is refused with another status', async () => {
    const network = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValueOnce(network)
    fetchMock.mockResolvedValueOnce(refusal(404, 'Not found'))

    await expect(login(STANDARD)).rejects.toBe(network)
  })

  it('passes a refusal the server answered straight through, asking nothing more', async () => {
    fetchMock.mockResolvedValueOnce(refusal(403, MIRROR_UNPAIRED))

    const err = await login(STANDARD).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toBe(MIRROR_UNPAIRED)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('passes an error that is no network error straight through', async () => {
    fetchMock.mockResolvedValueOnce(refusal(401, 'Logon failure: unknown user name or bad password.'))

    const err = await login(STANDARD).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
