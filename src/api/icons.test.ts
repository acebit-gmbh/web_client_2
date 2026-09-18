import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiError, configureApi, type ApiBindings } from './client'
import {
  getDatabaseIcon,
  getDatabaseIcons,
  isDatabaseIconId,
  listDatabaseIcons,
  uploadDatabaseIcon,
} from './icons'
import { PNG_BASE64, iconsResponse, okIcon } from '@/test/iconFixtures'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const BASE = 'https://pd.example.com:8714/v2.0'

describe('database icon routes', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let onActivity: ReturnType<typeof vi.fn>
  let onAuthFailure: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    onActivity = vi.fn()
    onAuthFailure = vi.fn()
    configureApi({
      getContext: vi.fn(() => ({
        serverOrigin: 'https://pd.example.com:8714' as string,
        token: 'test-token' as string | null,
      })) as ApiBindings['getContext'],
      onActivity: onActivity as ApiBindings['onActivity'],
      onAuthFailure: onAuthFailure as ApiBindings['onAuthFailure'],
    })
  })

  const requestInit = (call = 0) => fetchMock.mock.calls[call][1] as RequestInit

  describe('isDatabaseIconId', () => {
    it.each(['0', '3', '999999'])('accepts %j', (id) => {
      expect(isDatabaseIconId(id)).toBe(true)
    })

    it.each([
      '',
      '1234567',
      'abc',
      '3a',
      '-1',
      '1.5',
      ' 3',
      '3\n',
      '../x',
      '1,2',
      3,
      null,
      undefined,
    ])('refuses %j', (id) => {
      expect(isDatabaseIconId(id)).toBe(false)
    })
  })

  describe('listDatabaseIcons', () => {
    it('GETs the metadata list through the standard pager and counts as activity', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: '3', name: 'example.com', version: '9c1e5f2a-10f4-2b1' }],
          total: 1,
          offset: 0,
          limit: 200,
        }),
      )
      const list = await listDatabaseIcons('d')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/databases/d/icons?offset=0&limit=200`)
      expect(requestInit().method ?? 'GET').toBe('GET')
      expect(list.data).toEqual([{ id: '3', name: 'example.com', version: '9c1e5f2a-10f4-2b1' }])
      expect(onActivity).toHaveBeenCalledTimes(1)
    })

    it('never asks for image data and fetches the remaining pages', async () => {
      const page = (offset: number, count: number) =>
        jsonResponse({
          data: Array.from({ length: count }, (_, i) => ({
            id: String(offset + i),
            name: `n${offset + i}`,
            version: 'v',
          })),
          total: 450,
          offset,
          limit: 200,
        })
      fetchMock
        .mockResolvedValueOnce(page(0, 200))
        .mockResolvedValueOnce(page(200, 200))
        .mockResolvedValueOnce(page(400, 50))

      const list = await listDatabaseIcons('d')
      const urls = fetchMock.mock.calls.map((call) => call[0] as string)
      expect(urls).toEqual([
        `${BASE}/databases/d/icons?offset=0&limit=200`,
        `${BASE}/databases/d/icons?offset=200&limit=200`,
        `${BASE}/databases/d/icons?offset=400&limit=200`,
      ])
      expect(urls.some((url) => url.includes('include') || url.includes('ids='))).toBe(false)
      expect(list.data).toHaveLength(450)
    })
  })

  describe('getDatabaseIcons', () => {
    it('GETs ?ids=...&include=data with literal commas', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(iconsResponse(okIcon('3'), okIcon('7'))))
      const batch = await getDatabaseIcons('d', ['3', '7'])
      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/databases/d/icons?ids=3,7&include=data`)
      expect(requestInit().method ?? 'GET').toBe('GET')
      expect((requestInit().headers as Headers).get('Authorization')).toBe('Bearer test-token')
      expect(requestInit().cache).toBe('no-store')
      expect(batch.data[0].data).toBe(PNG_BASE64)
    })

    it('is background traffic: a successful answer does not reset the session watchdog', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(iconsResponse(okIcon('3'))))
      await getDatabaseIcons('d', ['3'])
      expect(onActivity).not.toHaveBeenCalled()
    })

    it('still logs out on 401', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
      await expect(getDatabaseIcons('d', ['3'])).rejects.toBeInstanceOf(ApiError)
      expect(onAuthFailure).toHaveBeenCalledTimes(1)
    })

    it.each([[['3', '../entries']], [['3', '7;8']], [['']], [['1234567']], [[]]])(
      'refuses the ids %j without a request',
      async (ids) => {
        await expect(getDatabaseIcons('d', ids)).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
      },
    )

    it('surfaces a plain 400 (too many ids) as ApiError', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: 400, message: 'Bad request.' } }, { status: 400 }),
      )
      const err = await getDatabaseIcons('d', ['3']).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(400)
      expect((err as ApiError).code).toBe(400)
    })
  })

  describe('getDatabaseIcon', () => {
    it('GETs the item route and does not count as activity', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(okIcon('7')))
      const icon = await getDatabaseIcon('d', '7')
      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/databases/d/icons/7`)
      expect(requestInit().method ?? 'GET').toBe('GET')
      expect(icon.state).toBe('ok')
      expect(onActivity).not.toHaveBeenCalled()
    })

    it('keeps "no usable icon with that id" distinguishable as 404 / 4042', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: 4042, message: 'No such icon.' } }, { status: 404 }),
      )
      const err = await getDatabaseIcon('d', '7').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(404)
      expect((err as ApiError).code).toBe(4042)
    })

    it('keeps a plain 404 (database unknown, older server) apart from 4042', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      const err = await getDatabaseIcon('d', '7').catch((e: unknown) => e)
      expect((err as ApiError).status).toBe(404)
      expect((err as ApiError).code).toBe(404)
    })

    it.each(['../../entries/e', '7/extra', 'example.com', ''])(
      'refuses the id %j without a request',
      async (id) => {
        await expect(getDatabaseIcon('d', id)).rejects.toThrow()
        expect(fetchMock).not.toHaveBeenCalled()
      },
    )
  })

  describe('uploadDatabaseIcon', () => {
    it('POSTs {name, data} as JSON and returns the authoritative name', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          { id: '7', name: 'example.com (2)', version: 'v7', created: true },
          { status: 201 },
        ),
      )
      const result = await uploadDatabaseIcon('d', { name: 'example.com', data: PNG_BASE64 })

      expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/databases/d/icons`)
      expect(requestInit().method).toBe('POST')
      expect((requestInit().headers as Headers).get('Content-Type')).toBe('application/json')
      expect(JSON.parse(requestInit().body as string)).toEqual({
        name: 'example.com',
        data: PNG_BASE64,
      })
      expect(result).toEqual({ id: '7', name: 'example.com (2)', version: 'v7', created: true })
      // A user action, unlike the image fetches.
      expect(onActivity).toHaveBeenCalledTimes(1)
    })

    it('returns created: false for the 200 of an identical icon', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ id: '7', name: 'example.com', version: 'v7', created: false }),
      )
      const result = await uploadDatabaseIcon('d', { name: 'example.com', data: PNG_BASE64 })
      expect(result.created).toBe(false)
    })

    it.each([
      [400, 4008],
      [413, 4131],
      [403, 4034],
      [403, 403],
      [400, 400],
    ])('surfaces the refusal %i / %i as ApiError(status, code)', async (status, code) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code, message: 'refused' } }, { status }),
      )
      const err = await uploadDatabaseIcon('d', { name: 'n', data: PNG_BASE64 }).catch(
        (e: unknown) => e,
      )
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(status)
      expect((err as ApiError).code).toBe(code)
      expect(onActivity).not.toHaveBeenCalled()
    })

    it('lets a network failure (header-stage 413 without CORS) through as TypeError', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      await expect(uploadDatabaseIcon('d', { name: 'n', data: PNG_BASE64 })).rejects.toBeInstanceOf(
        TypeError,
      )
    })
  })
})
