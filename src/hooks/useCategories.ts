import { useQuery } from '@tanstack/react-query'
import { listCategories } from '@/api/categories'

/**
 * The categories a database offers, for the entry editor's picker.
 *
 * `retry: false` because the expected failure is a 404 from a server older
 * than 20.0.0, and retrying a missing route only delays the form. Callers read
 * `data?.data ?? []`: an empty list and a missing route look the same to the
 * field, which stays free text in both cases.
 */
export function useCategories(dbId: string | null | undefined) {
  return useQuery({
    queryKey: ['db-categories', dbId],
    queryFn: () => listCategories(dbId!),
    enabled: !!dbId,
    retry: false,
  })
}
