import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { getDatabaseIcon, getDatabaseIcons, isDatabaseIconId } from '@/api/icons'
import type { DatabaseIcon, DatabaseIconRef, PaginatedResponse } from '@/api/types'

// Database icons (Server 20.0.0+) reach the page as `data:` URLs built from
// the base64 the server sends inside JSON. The app's CSP allows exactly that
// (`img-src 'self' data: https:`); `blob:` is NOT allowed, so an object URL
// would be blocked - never use URL.createObjectURL to display an icon. The
// bytes are only ever handed to an <img>: never innerHTML, never inline SVG.

/**
 * What a `['db-icon', ...]` query holds: a `data:` URL, or null for an icon
 * that is known to be unusable or gone (the negative cache - show the
 * fallback and do not ask again this session).
 */
export type DbIconValue = string | null

/** TanStack cache key of one icon image. The version is part of the key: a changed image is a new entry. */
export function dbIconKey(dbId: string, id: string, version: string) {
  return ['db-icon', dbId, id, version] as const
}

// ─── data: URL ───────────────────────────────────────────────

/**
 * The only image types the server serves for a database icon, each with the
 * base64 spelling of its file signature (PNG: 89 50 4E 47 0D 0A 1A 0A, BMP:
 * "BM"). A Map, not an object literal, so `constructor` and friends are not
 * content types.
 */
const ICON_SIGNATURES: ReadonlyMap<string, string> = new Map([
  ['image/png', 'iVBORw0KGgo'],
  ['image/bmp', 'Qk'],
])

/** The server serves at most 1 MiB of image; this is that size in base64 characters. */
export const MAX_ICON_BASE64_LENGTH = Math.ceil((1024 * 1024) / 3) * 4

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

/** RFC 4648 base64, standard alphabet, padded, no line breaks - exactly what the server documents. */
function isStrictBase64(text: string): boolean {
  return text.length > 0 && text.length % 4 === 0 && BASE64_RE.test(text)
}

/**
 * Turns the `content_type` + `data` of an icon into a `data:` URL, or null
 * when anything about them is off. Server data is untrusted here: the type
 * must be exactly `image/png` or `image/bmp` (SVG and everything else is
 * refused, whatever the server says), the text must be strict base64 of a
 * sane length, and it must start with the signature of the declared type.
 */
export function toIconDataUrl(contentType: unknown, data: unknown): string | null {
  if (typeof contentType !== 'string' || typeof data !== 'string') return null
  const signature = ICON_SIGNATURES.get(contentType)
  if (signature === undefined) return null
  if (data.length > MAX_ICON_BASE64_LENGTH || !isStrictBase64(data)) return null
  if (!data.startsWith(signature)) return null
  return `data:${contentType};base64,${data}`
}

// ─── Batcher ─────────────────────────────────────────────────

/** `icons.batch_max` of the contract; used when the capability carries no usable number. */
export const DEFAULT_ICON_BATCH_MAX = 32
/** Upper bound for a published `batch_max`, so a request URL stays short whatever a server claims. */
const MAX_ICON_BATCH_MAX = 100
/**
 * The server answers every request with `Connection: close`, and each
 * distinct cross-origin URL costs a CORS preflight of its own - more than a
 * few parallel requests only queue up in the browser and starve the calls
 * the user is actually waiting for.
 */
const MAX_REQUESTS_IN_FLIGHT = 3

function normalizeBatchMax(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ICON_BATCH_MAX
  return Math.min(Math.max(Math.floor(value), 1), MAX_ICON_BATCH_MAX)
}

/** The two image routes; injectable so tests can count and delay requests. */
export interface DbIconApi {
  getDatabaseIcons: (
    dbId: string,
    ids: readonly string[],
  ) => Promise<PaginatedResponse<DatabaseIcon>>
  getDatabaseIcon: (dbId: string, iconId: string) => Promise<DatabaseIcon>
}

interface Waiter {
  queryClient: QueryClient
  promise: Promise<DbIconValue>
  resolve: (value: DbIconValue) => void
  reject: (reason: unknown) => void
}

/** Everyone waiting for one icon id, by the version their row carries. */
type Waiters = Map<string, Waiter>

interface PendingDatabase {
  batchMax: number
  icons: Map<string, Waiters>
}

interface Job {
  run: () => Promise<void>
  /** Settles the job's waiters without a request (the batcher was reset while it queued). */
  cancel: () => void
}

function createWaiter(queryClient: QueryClient): Waiter {
  let resolve!: Waiter['resolve']
  let reject!: Waiter['reject']
  const promise = new Promise<DbIconValue>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { queryClient, promise, resolve, reject }
}

function isIconItem(value: unknown): value is DatabaseIcon {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<DatabaseIcon>
  return isDatabaseIconId(item.id) && typeof item.version === 'string' && item.version !== ''
}

/**
 * A refusal that will be the same next time (unknown database, malformed
 * request, 404/4042 no such icon): negative-cache it. 401 (the session is
 * gone), 408 and 429 are about the moment, not about the icon, and so is
 * everything that is not an HTTP answer at all.
 */
function isLastingRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.status < 400 || err.status >= 500) return false
  return err.status !== 401 && err.status !== 408 && err.status !== 429
}

/**
 * DataLoader-style loader for icon images. A folder listing mounts many
 * icons at once, and the server has no keep-alive, so:
 *
 * - every miss of one tick is collected and asked for together,
 *   `GET /icons?ids=...&include=data`, in chunks of `icons.batch_max`;
 * - at most three requests are in flight, batch and single alike;
 * - `state: deferred` items fall through to the single-icon route;
 * - `state: unusable`, and ids that do not come back, resolve to null (the
 *   caller caches that: negative cache);
 * - an image belongs to the RETURNED version. When that is not the version
 *   the row carried, the row is stale: the image is cached under the
 *   returned version, the asker gets null (fallback), and the database's
 *   row listings are invalidated - once per (database, id, version), and
 *   only when the loader has gone idle, so one refetch covers them all.
 *
 * The loader resolves values; caching them under `dbIconKey` is the job of
 * the query that called it (see useDbIcon).
 */
export class DbIconBatcher {
  private readonly api: DbIconApi
  private pending = new Map<string, PendingDatabase>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Job[] = []
  private inFlight = 0
  /** Bumped by reset(); a request that started before it must not touch the cache afterwards. */
  private generation = 0
  private staleSeen = new Set<string>()
  private staleRows = new Map<QueryClient, Set<string>>()

  constructor(api: DbIconApi) {
    this.api = api
  }

  /**
   * The image of `ref` in database `dbId` as a `data:` URL, or null when the
   * icon is unusable, gone, or no longer at the version the row carried.
   * Rejects only for failures worth another try later (network, 5xx, 401).
   */
  load(
    queryClient: QueryClient,
    dbId: string,
    ref: Pick<DatabaseIconRef, 'id' | 'version'>,
    batchMax?: number,
  ): Promise<DbIconValue> {
    // Never let a malformed id reach a URL; a row without a version has no cache identity.
    if (!dbId || !isDatabaseIconId(ref.id) || typeof ref.version !== 'string' || !ref.version) {
      return Promise.resolve(null)
    }

    let database = this.pending.get(dbId)
    if (!database) {
      database = { batchMax: DEFAULT_ICON_BATCH_MAX, icons: new Map() }
      this.pending.set(dbId, database)
    }
    database.batchMax = normalizeBatchMax(batchMax)

    let waiters = database.icons.get(ref.id)
    if (!waiters) {
      waiters = new Map()
      database.icons.set(ref.id, waiters)
    }
    let waiter = waiters.get(ref.version)
    if (!waiter) {
      waiter = createWaiter(queryClient)
      waiters.set(ref.version, waiter)
    }

    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, 0)
    }
    return waiter.promise
  }

  /**
   * Forgets everything (logout: the next login may be to another server).
   * Queued work is dropped without a request; answers still on their way are
   * ignored when they arrive, so they cannot repopulate a cleared cache.
   */
  reset(): void {
    this.generation += 1
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const database of this.pending.values()) {
      for (const waiters of database.icons.values()) settleAll(waiters, null)
    }
    this.pending.clear()
    const queued = this.queue
    this.queue = []
    for (const job of queued) job.cancel()
    this.staleSeen.clear()
    this.staleRows.clear()
  }

  private flush(): void {
    const pending = this.pending
    this.pending = new Map()
    for (const [dbId, database] of pending) {
      const ids = [...database.icons.keys()]
      for (let start = 0; start < ids.length; start += database.batchMax) {
        const chunk = new Map<string, Waiters>()
        for (const id of ids.slice(start, start + database.batchMax)) {
          chunk.set(id, database.icons.get(id)!)
        }
        this.enqueue(this.batchJob(dbId, chunk))
      }
    }
  }

  private enqueue(job: Job): void {
    this.queue.push(job)
    this.pump()
  }

  private pump(): void {
    while (this.inFlight < MAX_REQUESTS_IN_FLIGHT && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.inFlight += 1
      void job
        .run()
        // run() handles request failures itself; this is the net under a
        // bug, so that no waiter is left hanging.
        .catch(() => job.cancel())
        .finally(() => {
          this.inFlight -= 1
          this.pump()
          if (this.inFlight === 0 && this.queue.length === 0) this.invalidateStaleRows()
        })
    }
  }

  private batchJob(dbId: string, chunk: Map<string, Waiters>): Job {
    const generation = this.generation
    return {
      cancel: () => {
        for (const waiters of chunk.values()) settleAll(waiters, null)
      },
      run: async () => {
        let items: unknown
        try {
          items = (await this.api.getDatabaseIcons(dbId, [...chunk.keys()])).data
        } catch (err) {
          for (const waiters of chunk.values()) this.fail(waiters, err, generation)
          return
        }
        const returned = new Map<string, DatabaseIcon>()
        if (Array.isArray(items)) {
          for (const item of items) {
            if (isIconItem(item) && !returned.has(item.id)) returned.set(item.id, item)
          }
        }
        for (const [id, waiters] of chunk) {
          const icon = returned.get(id)
          if (icon?.state === 'deferred' && generation === this.generation) {
            // Left out of this answer by the server's byte budget, not broken.
            this.enqueue(this.singleJob(dbId, id, waiters))
          } else {
            // An id that did not come back is gone.
            this.settle(dbId, id, icon ?? null, waiters, generation)
          }
        }
      },
    }
  }

  private singleJob(dbId: string, id: string, waiters: Waiters): Job {
    const generation = this.generation
    return {
      cancel: () => settleAll(waiters, null),
      run: async () => {
        let icon: unknown
        try {
          icon = await this.api.getDatabaseIcon(dbId, id)
        } catch (err) {
          this.fail(waiters, err, generation)
          return
        }
        // An answer about another id is no answer.
        const usable = isIconItem(icon) && icon.id === id ? icon : null
        this.settle(dbId, id, usable, waiters, generation)
      },
    }
  }

  private fail(waiters: Waiters, err: unknown, generation: number): void {
    if (generation !== this.generation || isLastingRefusal(err)) {
      settleAll(waiters, null)
      return
    }
    for (const waiter of waiters.values()) waiter.reject(err)
  }

  private settle(
    dbId: string,
    id: string,
    icon: DatabaseIcon | null,
    waiters: Waiters,
    generation: number,
  ): void {
    if (icon === null || generation !== this.generation) {
      settleAll(waiters, null)
      return
    }
    // Only `ok` carries an image. `unusable` - and any state this client
    // does not know - is the fallback, remembered for this id + version.
    warnAboutMissingState(icon)
    const value = icon.state === 'ok' ? toIconDataUrl(icon.content_type, icon.data) : null

    for (const [version, waiter] of waiters) {
      if (version === icon.version) {
        waiter.resolve(value)
        continue
      }
      // The row that asked is older than the stored image. Keep what came
      // back under ITS version, so the re-read row finds it in the cache.
      if (!waiters.has(icon.version)) {
        waiter.queryClient.setQueryData<DbIconValue>(dbIconKey(dbId, id, icon.version), value)
      }
      waiter.resolve(null)
      this.markRowsStale(waiter.queryClient, dbId, id, version)
    }
  }

  private markRowsStale(queryClient: QueryClient, dbId: string, id: string, version: string): void {
    const seen = `${dbId}\n${id}\n${version}`
    if (this.staleSeen.has(seen)) return
    this.staleSeen.add(seen)
    let databases = this.staleRows.get(queryClient)
    if (!databases) {
      databases = new Set()
      this.staleRows.set(queryClient, databases)
    }
    databases.add(dbId)
  }

  private invalidateStaleRows(): void {
    const stale = this.staleRows
    this.staleRows = new Map()
    for (const [queryClient, databases] of stale) {
      for (const dbId of databases) {
        void queryClient.invalidateQueries({ queryKey: ['children', dbId] })
        void queryClient.invalidateQueries({ queryKey: ['search', dbId] })
        // The icon list carries versions too, and the picker is built from
        // it: without this a tile whose image was replaced elsewhere keeps
        // asking for the version it was listed with and stays a blank square.
        void queryClient.invalidateQueries({ queryKey: ['db-icons', dbId] })
      }
    }
  }
}

/**
 * `state` is required on an item that carries image fields, and an item
 * without it resolves to the fallback and stays that way for the session.
 * A server that forgets it therefore looks like a vault of broken icons with
 * nothing anywhere saying why - so development says it out loud (once per
 * icon and version, since the verdict is cached). The rule stays strict:
 * a state this client does not know must never render.
 */
function warnAboutMissingState(icon: DatabaseIcon): void {
  if (!import.meta.env.DEV) return
  if (typeof icon.state === 'string' || typeof icon.data !== 'string') return
  if (!ICON_SIGNATURES.has(icon.content_type as string)) return
  console.warn(
    `Database icon ${icon.id} carries image data but no "state": the image is ignored. ` +
      'The server must send state: "ok" on the item route and on include=data items.',
  )
}

function settleAll(waiters: Waiters, value: DbIconValue): void {
  for (const waiter of waiters.values()) waiter.resolve(value)
}

/** The app's loader. Reset on logout (authStore). */
export const dbIconBatcher = new DbIconBatcher({ getDatabaseIcons, getDatabaseIcon })
