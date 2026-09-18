import { useQuery } from '@tanstack/react-query'
import { listDatabaseIcons } from '@/api/icons'
import { useIconCapability } from '@/hooks/useIconCapability'

/**
 * The icons stored in a database - `id`, `name`, `version`, no image data
 * (images come through useDbIcon). Disabled until the database reports the
 * `icons` capability, so an older server is never asked.
 */
export function useDatabaseIcons(dbId: string | null | undefined) {
  const capability = useIconCapability(dbId)
  return useQuery({
    queryKey: ['db-icons', dbId],
    queryFn: () => listDatabaseIcons(dbId!),
    enabled: !!dbId && capability !== undefined,
  })
}
