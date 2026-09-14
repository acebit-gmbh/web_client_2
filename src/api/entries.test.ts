import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiError, configureApi, type ApiBindings } from './client'
import { getEntryOtp } from './entries'

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
