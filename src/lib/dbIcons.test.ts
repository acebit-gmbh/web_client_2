import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  DbIconBatcher,
  MAX_ICON_BASE64_LENGTH,
  dbIconKey,
  toIconDataUrl,
  type DbIconApi,
} from './dbIcons'
import { ApiError } from '@/api/client'
import type { DatabaseIcon, PaginatedResponse } from '@/api/types'
import { PNG_BASE64, PNG_DATA_URL, iconsResponse, okIcon } from '@/test/iconFixtures'

/** Lets the collection timer (setTimeout 0) fire and every settled promise run its callbacks. */
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('toIconDataUrl', () => {
  it('builds a data: URL for a PNG', () => {
    expect(toIconDataUrl('image/png', PNG_BASE64)).toBe(PNG_DATA_URL)
  })

  it('builds a data: URL for a legacy BMP', () => {
    const bmp = btoa('BM' + '\0'.repeat(28))
    expect(toIconDataUrl('image/bmp', bmp)).toBe(`data:image/bmp;base64,${bmp}`)
  })

  it.each([
    'image/svg+xml',
    'image/jpeg',
    'image/gif',
    'image/x-icon',
    'text/html',
    'image/PNG',
    'image/png; charset=utf-8',
    ' image/png',
    '',
    'constructor',
    '__proto__',
  ])('refuses the content type %j', (type) => {
    expect(toIconDataUrl(type, PNG_BASE64)).toBeNull()
  })

  it.each([
    ['not a string', 42],
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['a data: prefix', `data:image/png;base64,${PNG_BASE64}`],
    ['a line break', `${PNG_BASE64.slice(0, 40)}\n${PNG_BASE64.slice(40)}`],
    ['a space', `${PNG_BASE64.slice(0, 40)} ${PNG_BASE64.slice(41)}`],
    ['the URL-safe alphabet (_)', `${PNG_BASE64.slice(0, 40)}_${PNG_BASE64.slice(41)}`],
    ['the URL-safe alphabet (-)', `${PNG_BASE64.slice(0, 40)}-${PNG_BASE64.slice(41)}`],
    ['a quote that would end an attribute', `${PNG_BASE64.slice(0, 92)}"x=='`],
    ['padding in the middle', `${PNG_BASE64.slice(0, 40)}==${PNG_BASE64.slice(42)}`],
    ['three padding characters', `${PNG_BASE64.slice(0, 93)}===`],
    ['a length that is not a multiple of 4', PNG_BASE64.slice(0, 95)],
  ])('refuses data with %s', (_label, data) => {
    expect(toIconDataUrl('image/png', data)).toBeNull()
  })

  it('refuses data whose signature is not that of the declared type', () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(toIconDataUrl('image/png', svg)).toBeNull()
    expect(toIconDataUrl('image/bmp', PNG_BASE64)).toBeNull()
    expect(toIconDataUrl('image/png', btoa('BM' + '\0'.repeat(28)))).toBeNull()
  })

  it('refuses data longer than the 1 MiB the server ever serves', () => {
    const atLimit = PNG_BASE64.slice(0, 12) + 'A'.repeat(MAX_ICON_BASE64_LENGTH - 12)
    expect(toIconDataUrl('image/png', atLimit)).not.toBeNull()
    expect(toIconDataUrl('image/png', atLimit + 'AAAA')).toBeNull()
  })
})

describe('DbIconBatcher', () => {
  let queryClient: QueryClient
  let getDatabaseIcons: ReturnType<typeof vi.fn<DbIconApi['getDatabaseIcons']>>
  let getDatabaseIcon: ReturnType<typeof vi.fn<DbIconApi['getDatabaseIcon']>>
  let batcher: DbIconBatcher

  beforeEach(() => {
    queryClient = new QueryClient()
    // Default server: every requested id exists, at version `v<id>`.
    getDatabaseIcons = vi.fn<DbIconApi['getDatabaseIcons']>(async (_dbId, ids) =>
      iconsResponse(...ids.map((id) => okIcon(id))),
    )
    getDatabaseIcon = vi.fn<DbIconApi['getDatabaseIcon']>(async (_dbId, id) => okIcon(id))
    batcher = new DbIconBatcher({ getDatabaseIcons, getDatabaseIcon })
  })

  const ref = (id: string, version = `v${id}`) => ({ id, version })

  it('asks for every miss of one tick in a single request', async () => {
    const results = Promise.all([
      batcher.load(queryClient, 'db', ref('3'), 32),
      batcher.load(queryClient, 'db', ref('7'), 32),
      batcher.load(queryClient, 'db', ref('12'), 32),
    ])
    expect(getDatabaseIcons).not.toHaveBeenCalled()

    expect(await results).toEqual([PNG_DATA_URL, PNG_DATA_URL, PNG_DATA_URL])
    expect(getDatabaseIcons).toHaveBeenCalledTimes(1)
    expect(getDatabaseIcons).toHaveBeenCalledWith('db', ['3', '7', '12'])
    expect(getDatabaseIcon).not.toHaveBeenCalled()
  })

  it('dedupes the same icon asked for twice in a tick', async () => {
    const first = batcher.load(queryClient, 'db', ref('3'), 32)
    const second = batcher.load(queryClient, 'db', ref('3'), 32)
    expect(second).toBe(first)
    await first
    expect(getDatabaseIcons).toHaveBeenCalledTimes(1)
    expect(getDatabaseIcons).toHaveBeenCalledWith('db', ['3'])
  })

  it('starts a new collection on the next tick', async () => {
    await batcher.load(queryClient, 'db', ref('3'), 32)
    await batcher.load(queryClient, 'db', ref('4'), 32)
    expect(getDatabaseIcons.mock.calls.map(([, ids]) => ids)).toEqual([['3'], ['4']])
  })

  it('keeps the databases apart', async () => {
    await Promise.all([
      batcher.load(queryClient, 'db-a', ref('3'), 32),
      batcher.load(queryClient, 'db-b', ref('3'), 32),
    ])
    expect(getDatabaseIcons).toHaveBeenCalledTimes(2)
    expect(getDatabaseIcons).toHaveBeenCalledWith('db-a', ['3'])
    expect(getDatabaseIcons).toHaveBeenCalledWith('db-b', ['3'])
  })

  it('chunks at icons.batch_max', async () => {
    const ids = Array.from({ length: 70 }, (_, i) => String(i + 1))
    await Promise.all(ids.map((id) => batcher.load(queryClient, 'db', ref(id), 32)))
    expect(getDatabaseIcons.mock.calls.map(([, chunk]) => chunk.length)).toEqual([32, 32, 6])
    expect(getDatabaseIcons.mock.calls.flatMap(([, chunk]) => chunk)).toEqual(ids)
  })

  it('honours a smaller published batch_max, and falls back to 32 for nonsense', async () => {
    await Promise.all(
      ['1', '2', '3', '4', '5'].map((id) => batcher.load(queryClient, 'db', ref(id), 2)),
    )
    expect(getDatabaseIcons.mock.calls.map(([, chunk]) => chunk.length)).toEqual([2, 2, 1])

    getDatabaseIcons.mockClear()
    const many = Array.from({ length: 40 }, (_, i) => String(i + 100))
    await Promise.all(many.map((id) => batcher.load(queryClient, 'db', ref(id), Number.NaN)))
    expect(getDatabaseIcons.mock.calls.map(([, chunk]) => chunk.length)).toEqual([32, 8])
  })

  it('never has more than 3 requests in flight', async () => {
    const release: Array<() => void> = []
    let inFlight = 0
    let peak = 0
    getDatabaseIcons.mockImplementation(
      (_dbId, ids) =>
        new Promise<PaginatedResponse<DatabaseIcon>>((resolve) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          release.push(() => {
            inFlight -= 1
            resolve(iconsResponse(...ids.map((id) => okIcon(id))))
          })
        }),
    )

    const ids = Array.from({ length: 32 * 5 }, (_, i) => String(i + 1))
    const all = Promise.all(ids.map((id) => batcher.load(queryClient, 'db', ref(id), 32)))
    await tick()
    expect(getDatabaseIcons).toHaveBeenCalledTimes(3)

    release.shift()!()
    await tick()
    expect(getDatabaseIcons).toHaveBeenCalledTimes(4)

    while (release.length > 0) {
      release.shift()!()
      await tick()
    }
    expect(getDatabaseIcons).toHaveBeenCalledTimes(5)
    expect(peak).toBe(3)
    expect((await all).every((url) => url === PNG_DATA_URL)).toBe(true)
  })

  it('fetches a deferred icon with the single-icon route', async () => {
    getDatabaseIcons.mockResolvedValueOnce(
      iconsResponse(okIcon('3'), { id: '7', name: 'big', version: 'v7', state: 'deferred' }),
    )
    const [small, big] = await Promise.all([
      batcher.load(queryClient, 'db', ref('3'), 32),
      batcher.load(queryClient, 'db', ref('7'), 32),
    ])
    expect(small).toBe(PNG_DATA_URL)
    expect(big).toBe(PNG_DATA_URL)
    expect(getDatabaseIcon).toHaveBeenCalledTimes(1)
    expect(getDatabaseIcon).toHaveBeenCalledWith('db', '7')
  })

  it('counts single-icon requests against the same limit of 3', async () => {
    getDatabaseIcons.mockImplementation(async (_dbId, ids) =>
      iconsResponse(...ids.map((id) => ({ id, name: id, version: `v${id}`, state: 'deferred' }))),
    )
    const release: Array<() => void> = []
    getDatabaseIcon.mockImplementation(
      (_dbId, id) =>
        new Promise<DatabaseIcon>((resolve) => release.push(() => resolve(okIcon(id)))),
    )

    const all = Promise.all(
      ['1', '2', '3', '4', '5'].map((id) => batcher.load(queryClient, 'db', ref(id), 32)),
    )
    await tick()
    expect(getDatabaseIcon).toHaveBeenCalledTimes(3)
    while (release.length > 0) {
      release.shift()!()
      await tick()
    }
    expect(getDatabaseIcon).toHaveBeenCalledTimes(5)
    expect(await all).toEqual(Array(5).fill(PNG_DATA_URL))
  })

  it('resolves null for a 404/4042 on the single-icon route', async () => {
    getDatabaseIcons.mockResolvedValueOnce(
      iconsResponse({ id: '7', name: 'big', version: 'v7', state: 'deferred' }),
    )
    getDatabaseIcon.mockRejectedValueOnce(new ApiError(404, 4042, 'No such icon.'))
    expect(await batcher.load(queryClient, 'db', ref('7'), 32)).toBeNull()
  })

  it('resolves null for an unusable icon, an unknown state, and a bad image', async () => {
    // A missing `state` on an item that does carry an image is the likeliest
    // first-integration mistake, and it shows up as a vault full of
    // fallbacks: development says so once, the rule stays strict.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getDatabaseIcons.mockResolvedValueOnce(
      iconsResponse(
        { id: '1', name: 'a', version: 'v1', state: 'unusable' },
        { id: '2', name: 'b', version: 'v2', state: 'pending' },
        okIcon('3', 'v3', { content_type: 'image/svg+xml' }),
        okIcon('4', 'v4', { data: 'not base64!' }),
        // `ok` is the only state that carries an image, even when data is there
        okIcon('5', 'v5', { state: undefined }),
      ),
    )
    const results = await Promise.all(
      ['1', '2', '3', '4', '5'].map((id) => batcher.load(queryClient, 'db', ref(id), 32)),
    )
    expect(results).toEqual([null, null, null, null, null])
    expect(getDatabaseIcon).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('Database icon 5')
    warn.mockRestore()
  })

  it('treats a requested id that does not come back as gone', async () => {
    getDatabaseIcons.mockResolvedValueOnce(iconsResponse(okIcon('3')))
    const [there, gone] = await Promise.all([
      batcher.load(queryClient, 'db', ref('3'), 32),
      batcher.load(queryClient, 'db', ref('9'), 32),
    ])
    expect(there).toBe(PNG_DATA_URL)
    expect(gone).toBeNull()
    expect(getDatabaseIcon).not.toHaveBeenCalled()
  })

  it('ignores malformed and unrequested items in the answer', async () => {
    getDatabaseIcons.mockResolvedValueOnce({
      data: [
        null,
        'x',
        { id: 3, version: 'v3', state: 'ok', content_type: 'image/png', data: PNG_BASE64 },
        { id: '3', state: 'ok', content_type: 'image/png', data: PNG_BASE64 },
        okIcon('99'),
      ] as unknown as DatabaseIcon[],
      total: 5,
      offset: 0,
      limit: 5,
    })
    expect(await batcher.load(queryClient, 'db', ref('3'), 32)).toBeNull()
    expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
  })

  it.each(['', 'abc', '1234567', '3/../../entries', '-1', '1,2', ' 3'])(
    'never sends the malformed id %j to the server',
    async (id) => {
      expect(await batcher.load(queryClient, 'db', { id, version: 'v' }, 32)).toBeNull()
      await tick()
      expect(getDatabaseIcons).not.toHaveBeenCalled()
      expect(getDatabaseIcon).not.toHaveBeenCalled()
    },
  )

  it('resolves null for a row without a version or a database', async () => {
    expect(await batcher.load(queryClient, 'db', { id: '3', version: '' }, 32)).toBeNull()
    expect(await batcher.load(queryClient, '', ref('3'), 32)).toBeNull()
    await tick()
    expect(getDatabaseIcons).not.toHaveBeenCalled()
  })

  describe('version mismatch (the row is stale)', () => {
    it('gives the asker the fallback, caches the image under the returned version and invalidates the rows', async () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      getDatabaseIcons.mockResolvedValueOnce(iconsResponse(okIcon('3', 'v-new')))

      expect(await batcher.load(queryClient, 'db', ref('3', 'v-old'), 32)).toBeNull()
      await tick()

      expect(queryClient.getQueryData(dbIconKey('db', '3', 'v-new'))).toBe(PNG_DATA_URL)
      expect(invalidate).toHaveBeenCalledTimes(3)
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['children', 'db'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['search', 'db'] })
      // The picker is built from the icon list, which carries versions too.
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['db-icons', 'db'] })
    })

    it('invalidates only ONCE per (database, id, version)', async () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      getDatabaseIcons.mockImplementation(async () => iconsResponse(okIcon('3', 'v-new')))

      await batcher.load(queryClient, 'db', ref('3', 'v-old'), 32)
      await tick()
      expect(invalidate).toHaveBeenCalledTimes(3)

      // The re-read rows still carry the old version: no second round.
      await batcher.load(queryClient, 'db', ref('3', 'v-old'), 32)
      await tick()
      expect(invalidate).toHaveBeenCalledTimes(3)

      // Another stale version of the same icon is a new finding.
      await batcher.load(queryClient, 'db', ref('3', 'v-older'), 32)
      await tick()
      expect(invalidate).toHaveBeenCalledTimes(6)
    })

    it('invalidates once for a whole flush, after the last request', async () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      getDatabaseIcons.mockImplementation(async (_dbId, ids) =>
        iconsResponse(...ids.map((id) => okIcon(id, 'v-new'))),
      )
      const ids = Array.from({ length: 70 }, (_, i) => String(i + 1))
      await Promise.all(ids.map((id) => batcher.load(queryClient, 'db', ref(id, 'v-old'), 32)))
      await tick()

      expect(getDatabaseIcons).toHaveBeenCalledTimes(3)
      expect(invalidate).toHaveBeenCalledTimes(3)
    })

    it('serves a fresh row and a stale row of the same icon from one answer', async () => {
      const setQueryData = vi.spyOn(queryClient, 'setQueryData')
      getDatabaseIcons.mockResolvedValueOnce(iconsResponse(okIcon('3', 'v-new')))
      const [fresh, stale] = await Promise.all([
        batcher.load(queryClient, 'db', ref('3', 'v-new'), 32),
        batcher.load(queryClient, 'db', ref('3', 'v-old'), 32),
      ])
      expect(fresh).toBe(PNG_DATA_URL)
      expect(stale).toBeNull()
      expect(getDatabaseIcons).toHaveBeenCalledWith('db', ['3'])
      // The fresh asker caches its own result; the batcher must not write over it.
      expect(setQueryData).not.toHaveBeenCalled()
    })

    it('remembers an unusable image under the returned version too', async () => {
      getDatabaseIcons.mockResolvedValueOnce(
        iconsResponse({ id: '3', name: 'a', version: 'v-new', state: 'unusable' }),
      )
      expect(await batcher.load(queryClient, 'db', ref('3', 'v-old'), 32)).toBeNull()
      expect(queryClient.getQueryData(dbIconKey('db', '3', 'v-new'))).toBeNull()
      expect(queryClient.getQueryState(dbIconKey('db', '3', 'v-new'))?.status).toBe('success')
    })

    it('applies to the single-icon route as well', async () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      getDatabaseIcons.mockResolvedValueOnce(
        iconsResponse({ id: '7', name: 'big', version: 'v-old', state: 'deferred' }),
      )
      getDatabaseIcon.mockResolvedValueOnce(okIcon('7', 'v-new'))

      expect(await batcher.load(queryClient, 'db', ref('7', 'v-old'), 32)).toBeNull()
      await tick()
      expect(queryClient.getQueryData(dbIconKey('db', '7', 'v-new'))).toBe(PNG_DATA_URL)
      expect(invalidate).toHaveBeenCalledTimes(3)
    })
  })

  describe('request failures', () => {
    it.each([
      [404, 404],
      [400, 400],
      [403, 403],
    ])('negative-caches a lasting refusal (%i)', async (status, code) => {
      getDatabaseIcons.mockRejectedValueOnce(new ApiError(status, code, 'refused'))
      const results = await Promise.all([
        batcher.load(queryClient, 'db', ref('3'), 32),
        batcher.load(queryClient, 'db', ref('4'), 32),
      ])
      expect(results).toEqual([null, null])
    })

    it.each([
      ['a network failure', new TypeError('Failed to fetch')],
      ['a 500', new ApiError(500, 500, 'boom')],
      ['a 401', new ApiError(401, 401, 'expired')],
      ['a 429', new ApiError(429, 429, 'slow down')],
      ['a 408', new ApiError(408, 408, 'timeout')],
    ])('rejects on %s so a later mount can try again', async (_label, error) => {
      getDatabaseIcons.mockRejectedValueOnce(error)
      await expect(batcher.load(queryClient, 'db', ref('3'), 32)).rejects.toBe(error)

      // Nothing was remembered: the next ask goes out again.
      expect(await batcher.load(queryClient, 'db', ref('3'), 32)).toBe(PNG_DATA_URL)
      expect(getDatabaseIcons).toHaveBeenCalledTimes(2)
    })

    it('a failing chunk does not take the others down', async () => {
      getDatabaseIcons
        .mockRejectedValueOnce(new ApiError(500, 500, 'boom'))
        .mockImplementation(async (_dbId, ids) => iconsResponse(...ids.map((id) => okIcon(id))))
      const settled = await Promise.allSettled(
        ['1', '2', '3'].map((id) => batcher.load(queryClient, 'db', ref(id), 2)),
      )
      expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected', 'fulfilled'])
    })
  })

  describe('reset (logout)', () => {
    it('drops what was collected without a request', async () => {
      const pending = batcher.load(queryClient, 'db', ref('3'), 32)
      batcher.reset()
      expect(await pending).toBeNull()
      await tick()
      expect(getDatabaseIcons).not.toHaveBeenCalled()
    })

    it('drops queued requests and ignores answers that arrive afterwards', async () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      const release: Array<() => void> = []
      getDatabaseIcons.mockImplementation(
        (_dbId, ids) =>
          new Promise<PaginatedResponse<DatabaseIcon>>((resolve) =>
            // Every answer is a version mismatch: it would write to the cache.
            release.push(() => resolve(iconsResponse(...ids.map((id) => okIcon(id, 'v-new'))))),
          ),
      )
      const ids = Array.from({ length: 32 * 4 }, (_, i) => String(i + 1))
      const all = Promise.all(
        ids.map((id) => batcher.load(queryClient, 'db', ref(id, 'v-old'), 32)),
      )
      await tick()
      expect(getDatabaseIcons).toHaveBeenCalledTimes(3)

      batcher.reset()
      release.forEach((go) => go())
      expect((await all).every((url) => url === null)).toBe(true)
      await tick()

      // The fourth chunk was never sent, and nothing reached the cache.
      expect(getDatabaseIcons).toHaveBeenCalledTimes(3)
      expect(queryClient.getQueryCache().findAll()).toHaveLength(0)
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('works again afterwards', async () => {
      batcher.reset()
      expect(await batcher.load(queryClient, 'db', ref('3'), 32)).toBe(PNG_DATA_URL)
    })
  })
})
