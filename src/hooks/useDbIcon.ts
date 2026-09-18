import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dbIconBatcher, dbIconKey, type DbIconValue } from '@/lib/dbIcons'
import { findIconCapability } from '@/hooks/useIconCapability'
import type { DatabaseCompact, DatabaseIconRef, PaginatedResponse } from '@/api/types'

/** Unobserved icon images stay cached this long; the image of a version never changes, so it is never stale. */
const DB_ICON_GC_TIME = 30 * 60 * 1000

/**
 * The database reports no `icons` object, so there is nothing to fetch. It is
 * an error rather than a cached `null` on purpose: a verdict reached without
 * asking anyone must not be remembered for the session.
 */
class IconsUnsupportedError extends Error {
  constructor() {
    super('The database does not report the icons capability')
    this.name = 'IconsUnsupportedError'
  }
}

/**
 * The image of a database icon as a `data:` URL. Undefined while it is
 * loading, when the request failed, or when the server has no icon support;
 * null when the icon is known to be unusable or gone. In every case but a
 * string the caller shows its fallback (the standard icon named by `icon`).
 *
 * Mount this ONLY for a row whose `database_icon` is non-null (render the
 * component that calls it conditionally): the entry list is not virtualised,
 * and an observer per plain row would be thousands of idle ones.
 *
 * Requests are batched across all rows of a tick (see DbIconBatcher) and the
 * result is cached per (database, id, version): in memory only, dropped after
 * 30 unused minutes and when logout clears the query cache. Nothing refetches
 * it: not focus, not reconnect, not a retry.
 */
export function useDbIcon(
  dbId: string | null | undefined,
  icon: Pick<DatabaseIconRef, 'id' | 'version'>,
): DbIconValue | undefined {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: dbIconKey(dbId ?? '', icon.id, icon.version),
    queryFn: () => {
      // The capability is a property of the DATABASE, never of the row, so it
      // is read here - outside render, from the cache the vault page keeps
      // loaded - instead of through a hook. An observer per row would mean
      // thousands of idle observers on `['databases']` in a folder of
      // thousands of rows, on a list that is not virtualised.
      const capability = findIconCapability(
        queryClient.getQueryData<PaginatedResponse<DatabaseCompact>>(['databases']),
        dbId,
      )
      // An older server is never probed: it would answer `/icons` with 404.
      if (capability === undefined) return Promise.reject(new IconsUnsupportedError())
      return dbIconBatcher.load(queryClient, dbId!, icon, capability.batch_max)
    },
    enabled: !!dbId,
    staleTime: Infinity,
    gcTime: DB_ICON_GC_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
  return data
}
