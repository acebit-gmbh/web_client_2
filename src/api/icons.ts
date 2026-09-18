import { apiClient } from './client'
import { fetchAllPages } from './pagination'
import type { PaginatedResponse, DatabaseIcon, UploadIconRequest, UploadIconResult } from './types'

// Database icons (Server 20.0.0+). Call these only when the database object
// carries the `icons` capability: an older server answers the routes with a
// plain 404 and must never be probed.
//
// Image bytes travel only as base64 inside JSON - there is no binary icon
// route and no image URL. Icon NAMES never appear in a URL; icons are
// addressed by their opaque decimal `id`, which is valid only inside the
// database it came from.

/**
 * A 2xx answer to an upload that this client cannot use: without a `name`
 * there is nothing to put into `image_name`. The image IS stored - the
 * contract requires `name` on both 200 and 201, so a conforming server never
 * causes this - and sending the same bytes again is safe (200, same icon).
 */
export class IconUploadAnswerError extends Error {
  constructor() {
    super('Unusable answer to an icon upload')
    this.name = 'IconUploadAnswerError'
  }
}

/** An icon id as the server issues it: 1 to 6 decimal digits. Anything else must never reach a URL. */
const ICON_ID_RE = /^[0-9]{1,6}$/

export function isDatabaseIconId(value: unknown): value is string {
  return typeof value === 'string' && ICON_ID_RE.test(value)
}

function assertIconIds(ids: readonly string[]): void {
  for (const id of ids) {
    if (!isDatabaseIconId(id)) throw new Error('Invalid database icon id')
  }
}

/**
 * Every icon of the database, WITHOUT image data (`id`, `name`, `version`),
 * ordered by slot position. Removed and empty slots are never listed.
 */
export function listDatabaseIcons(dbId: string): Promise<PaginatedResponse<DatabaseIcon>> {
  return fetchAllPages<DatabaseIcon, PaginatedResponse<DatabaseIcon>>((offset, limit) =>
    apiClient<PaginatedResponse<DatabaseIcon>>(
      `/databases/${dbId}/icons?offset=${offset}&limit=${limit}`,
    ),
  )
}

/**
 * Up to `icons.batch_max` icons WITH their image, in one request. Each item
 * carries `state`: `ok` (image fields present), `unusable`, or `deferred`
 * (response byte budget reached - fetch that one with getDatabaseIcon). A
 * requested id that does not come back is gone. The caller chunks; more ids
 * than `batch_max` is a plain 400.
 *
 * Background traffic: does not reset the session watchdog.
 */
export async function getDatabaseIcons(
  dbId: string,
  ids: readonly string[],
): Promise<PaginatedResponse<DatabaseIcon>> {
  assertIconIds(ids)
  if (ids.length === 0) throw new Error('No database icon ids given')
  // The ids are digits only (checked above), so the list needs no encoding;
  // the comma stays literal, as the server documents it.
  return apiClient<PaginatedResponse<DatabaseIcon>>(
    `/databases/${dbId}/icons?ids=${ids.join(',')}&include=data`,
    { skipActivity: true },
  )
}

/**
 * One icon with its image (`state` is `ok`). 404 with `ApiError.code` 4042:
 * no usable icon with that id in THIS database - show the fallback and
 * negative-cache it. A plain 404 means the database is unknown or not
 * accessible. The bytes belong to the RETURNED `version`.
 *
 * Background traffic: does not reset the session watchdog.
 */
export async function getDatabaseIcon(dbId: string, iconId: string): Promise<DatabaseIcon> {
  assertIconIds([iconId])
  return apiClient<DatabaseIcon>(`/databases/${dbId}/icons/${iconId}`, { skipActivity: true })
}

/**
 * Stores a PNG (at most `icons.max_side` pixels per side and
 * `icons.max_bytes` bytes; first-party clients always send 64x64) in the
 * database's icon collection. 201 = stored (`created: true`), 200 = a
 * byte-identical icon of that name already existed (`created: false`).
 * Use the RETURNED `name` for `image_name` - it may be `name (2)`.
 *
 * Refusals by (status, `ApiError.code`): 400/4008 not a usable PNG,
 * 413/4131 bytes or pixels over the limit, 403/4034 quota reached, plain 403
 * mirror server or no upload right, plain 400 bad name. Validate the size
 * BEFORE sending: a body over 1 MB is refused at the header stage without
 * CORS headers, which a browser reports as a network error.
 */
export function uploadDatabaseIcon(
  dbId: string,
  icon: UploadIconRequest,
): Promise<UploadIconResult> {
  return apiClient<UploadIconResult>(`/databases/${dbId}/icons`, {
    method: 'POST',
    body: JSON.stringify(icon),
  })
}
