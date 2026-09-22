import { useQuery } from '@tanstack/react-query'
import { getUser } from '@/api/users'

/**
 * The name to show for a user id, or undefined while it is unknown.
 *
 * Undefined covers three cases the caller treats alike - not asked for, not
 * loaded yet, and a user who no longer exists (404) - because none of them is
 * worth a raw GUID on screen. `retry: false` for the same reason: a missing
 * user will not appear on a second attempt.
 */
export function useUserName(userId: string | null | undefined): string | undefined {
  const { data } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId!),
    enabled: !!userId,
    // Directory names change rarely and several rows usually share a deleter,
    // so one answer serves the whole view.
    staleTime: 15 * 60 * 1000,
    retry: false,
  })

  return data?.display_name?.trim() || data?.name?.trim() || undefined
}
