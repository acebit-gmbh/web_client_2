import { apiClient } from './client'
import { fetchAllPages } from './pagination'
import type { CompactItem, PaginatedResponse } from './types'

/**
 * A row of the recycle bin: the same compact representation a folder listing
 * returns, plus who deleted it. There is no companion timestamp - the server
 * records who, never when - so a bin listing cannot be ordered or labelled by
 * time.
 */
export type RecycleBinItem = CompactItem & {
  /** User id of whoever deleted it, the same kind of value as an entry's `author`. */
  deleted_by?: string
}

/**
 * What a database's recycle bin holds, of what this caller may see: their own
 * deletions always, other people's only where `recycle_bin.can_manage` says so.
 *
 * Server 20.0.0 and later. An older server has no such route and answers 404 -
 * which is the feature test for the whole bin, together with the absence of the
 * `recycle_bin` object on the database.
 */
export function listRecycleBin(dbId: string): Promise<PaginatedResponse<RecycleBinItem>> {
  // Paged to the end like every other listing here: a bin is browsed whole,
  // and it cannot be searched. `truncated` is set if the client ceiling is hit.
  return fetchAllPages<RecycleBinItem, PaginatedResponse<RecycleBinItem>>((offset, limit) => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
    return apiClient<PaginatedResponse<RecycleBinItem>>(
      `/databases/${dbId}/recyclebin?${params.toString()}`,
    )
  })
}

/**
 * Puts one item back where it was deleted from, or into the database root when
 * that folder is gone. Needs the right to change the folder it returns to, so
 * this can be refused (403) for an item the caller can see and even destroy.
 */
export function restoreRecycleBinItem(dbId: string, itemId: string): Promise<void> {
  return apiClient<void>(`/databases/${dbId}/recyclebin/${itemId}/restore`, {
    method: 'POST',
  })
}

/** Destroys one item for good. Needs the delete right on that item. */
export function purgeRecycleBinItem(dbId: string, itemId: string): Promise<void> {
  return apiClient<void>(`/databases/${dbId}/recyclebin/${itemId}`, {
    method: 'DELETE',
  })
}

/**
 * Destroys what this caller can see AND may delete. Anything else is left in
 * the bin and the call still answers 204, so never report this as "the bin is
 * empty" - re-read the list and let it say what is left.
 */
export function emptyRecycleBin(dbId: string): Promise<void> {
  return apiClient<void>(`/databases/${dbId}/recyclebin`, {
    method: 'DELETE',
  })
}
