import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isEntry, type CompactItem } from '@/api/types'
import { useTotpCapabilityStore } from '@/stores/totpCapabilityStore'

/**
 * Looks through every children/search listing already cached for the
 * database and reports whether its first entry row carries the `totp` key.
 * Folders never carry it; a listing without entries decides nothing.
 */
export function detectTotpCapability(queryClient: QueryClient, dbId: string): boolean | undefined {
  for (const prefix of ['children', 'search']) {
    for (const [, data] of queryClient.getQueriesData<{ data?: CompactItem[] }>({
      queryKey: [prefix, dbId],
    })) {
      const entry = data?.data?.find(isEntry)
      if (entry) return 'totp' in entry
    }
  }
  return undefined
}

/**
 * Whether the current server accepts the `totp` key on entry writes for
 * this database (Server 20.0.0+): true, false, or undefined while no entry
 * row has been seen yet. The create dialog has no entry of its own to look
 * at, so the verdict comes from any compact row of the database in the
 * TanStack cache and is remembered per database across folders. Callers
 * hide the editor unless the verdict is true.
 */
export function useTotpCapability(dbId: string | null): boolean | undefined {
  const queryClient = useQueryClient()
  const remembered = useTotpCapabilityStore((s) => (dbId ? s.verdicts[dbId] : undefined))
  const record = useTotpCapabilityStore((s) => s.record)

  const verdict =
    remembered !== undefined || !dbId ? remembered : detectTotpCapability(queryClient, dbId)

  useEffect(() => {
    if (dbId && verdict !== undefined) record(dbId, verdict)
  }, [dbId, verdict, record])

  return verdict
}
