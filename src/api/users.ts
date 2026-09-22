import { apiClient } from './client'

export interface UserCompact {
  id: string
  name: string
  display_name?: string
  department?: string
  email?: string
  disabled?: boolean
  updated_at?: string
}

/**
 * One user of the directory, by the id other responses refer to them with.
 *
 * Read-only and open to any signed-in caller, so it can be used to put a name
 * on an id the server hands out - `deleted_by` on a recycle bin row, which is
 * a GUID and shows nothing useful on its own. A user who has since been
 * removed answers 404; callers treat that as "no name", not as an error.
 */
export function getUser(userId: string): Promise<UserCompact> {
  return apiClient<UserCompact>(`/users/${encodeURIComponent(userId)}`)
}
