import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listDatabases } from '@/api/databases'
import type { DatabaseCompact, DatabaseIconsCapability, PaginatedResponse } from '@/api/types'

/**
 * The `icons` object of one database in a `/databases` listing, or undefined
 * when the database is not listed or carries none. Only a real object counts:
 * the capability is its presence, never a truthy value.
 */
export function findIconCapability(
  databases: PaginatedResponse<DatabaseCompact> | undefined,
  dbId: string | null | undefined,
): DatabaseIconsCapability | undefined {
  if (!dbId) return undefined
  const icons = databases?.data?.find((db) => db.id === dbId)?.icons
  return typeof icons === 'object' && icons !== null ? icons : undefined
}

/**
 * Whether the server implements database icons for this database (Server
 * 20.0.0+), and with which limits: the `icons` object on the cached database,
 * or undefined. Undefined means the feature is OFF - nothing icon-related is
 * fetched or sent, and the UI shows no trace of it. An older server is never
 * probed: it would answer `/icons` with 404 and store `image_*` unchecked.
 *
 * Unlike the one-time-code capability this needs no entry row, so it is
 * known for an empty database too, and it needs no store: it is read from
 * the `['databases']` query the vault page keeps loaded. The observer is
 * passive (`enabled: false`) - an icon in a list row must never be the
 * reason `/databases` is fetched again - and still follows every update of
 * that query.
 */
export function useIconCapability(
  dbId: string | null | undefined,
): DatabaseIconsCapability | undefined {
  const select = useCallback(
    (databases: PaginatedResponse<DatabaseCompact>) => findIconCapability(databases, dbId),
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
