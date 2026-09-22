import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDatabases } from '@/api/databases'
import type { DatabaseCompact, DatabaseRecycleBinCapability, PaginatedResponse } from '@/api/types'

/**
 * The `recycle_bin` object of one database in a `/databases` listing, or
 * undefined when the database is not listed or carries none. Only a real object
 * counts: the capability is its presence, never a truthy value.
 */
export function findRecycleBinCapability(
  databases: PaginatedResponse<DatabaseCompact> | undefined,
  dbId: string | null | undefined,
): DatabaseRecycleBinCapability | undefined {
  if (!dbId) return undefined
  const bin = databases?.data?.find((db) => db.id === dbId)?.recycle_bin
  return typeof bin === 'object' && bin !== null ? bin : undefined
}

/**
 * Whether this server keeps a recycle bin for this database (Server 20.0.0+),
 * and what this caller may do with it. Undefined means the feature is OFF -
 * no bin view, no `/recyclebin` call. An older server is never probed: it
 * answers those routes with 404.
 *
 * Note the two halves, which a UI must not confuse. `enabled` false means the
 * SERVER keeps no bin at all, so a delete is permanent and there is nothing to
 * show. `can_manage` only says whether this caller also sees what OTHER people
 * deleted; their own deletions are always theirs to see.
 *
 * Read from the `['databases']` query the vault page keeps loaded, passively
 * (`enabled: false`) - opening a bin must never be the reason `/databases` is
 * fetched again. Modelled on useIconCapability, which settled this pattern.
 */
export function useRecycleBinCapability(
  dbId: string | null | undefined,
): DatabaseRecycleBinCapability | undefined {
  const select = useCallback(
    (databases: PaginatedResponse<DatabaseCompact>) => findRecycleBinCapability(databases, dbId),
    [dbId],
  )
  const { data } = useQuery({
    queryKey: ['databases'],
    queryFn: () => listDatabases(),
    enabled: false,
    select,
  })
  return data
}
