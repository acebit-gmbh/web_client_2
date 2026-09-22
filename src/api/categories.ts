import { apiClient } from './client'

export interface CategoryList {
  /** The category names, sorted, without duplicates. Not paginated. */
  data: string[]
  total: number
}

/**
 * The database's own category list - the one the Windows client offers in its
 * entry editor, stored in the database file rather than derived from the
 * entries.
 *
 * Server 20.0.0 and later. An older server has no such route and answers 404,
 * which is the feature test: there is no capability object for this. Treat a
 * failure as "no list", never as an error worth showing - the category field
 * stays free text either way.
 */
export function listCategories(dbId: string): Promise<CategoryList> {
  return apiClient<CategoryList>(`/databases/${dbId}/categories`)
}
