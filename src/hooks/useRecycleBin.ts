import { useQuery } from '@tanstack/react-query'
import { listRecycleBin } from '@/api/recyclebin'
import { useRecycleBinCapability } from '@/hooks/useRecycleBinCapability'

/**
 * What the database's recycle bin holds, for the bin view.
 *
 * Gated on the capability rather than on a version, and not fetched at all
 * while the server keeps no bin: `enabled` false means there is nothing to
 * show. An older server has no `recycle_bin` object either, so it is never
 * asked.
 */
export function useRecycleBin(dbId: string | null | undefined) {
  const capability = useRecycleBinCapability(dbId)
  return useQuery({
    queryKey: ['recyclebin', dbId],
    queryFn: () => listRecycleBin(dbId!),
    enabled: !!dbId && capability?.enabled === true,
  })
}
