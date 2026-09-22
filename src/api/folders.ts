import { apiClient } from './client'
import { fetchAllPages } from './pagination'
import type {
  ChildrenResponse,
  CompactItem,
  FolderCompact,
  CreateFolderRequest,
  UpdateFolderRequest,
  MoveRequest,
} from './types'

export function getChildren(
  dbId: string,
  folderId?: string | null,
): Promise<ChildrenResponse> {
  const base = folderId
    ? `/databases/${dbId}/folders/${folderId}/children`
    : `/databases/${dbId}/children`

  // Note: the v2.0 children endpoint is gated only by ACL rights, never by a
  // second password (the server's ProcessListChildrenV2 does not check it), so
  // no X-Second-Password is sent here. The second password applies to the
  // full entry/folder detail reads, not to listing children.
  return fetchAllPages<CompactItem, ChildrenResponse>((offset, limit) =>
    apiClient<ChildrenResponse>(`${base}?offset=${offset}&limit=${limit}`),
  )
}

export function createFolder(
  dbId: string,
  data: CreateFolderRequest,
  parentFolderId?: string | null,
): Promise<FolderCompact> {
  const url = parentFolderId
    ? `/databases/${dbId}/folders?parent=${parentFolderId}`
    : `/databases/${dbId}/folders`
  return apiClient<FolderCompact>(url, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateFolder(
  dbId: string,
  folderId: string,
  data: UpdateFolderRequest,
  secondPassword?: string,
): Promise<FolderCompact> {
  return apiClient<FolderCompact>(`/databases/${dbId}/folders/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    secondPassword,
  })
}

/**
 * Server 20.0.0+ moves the item to the database's recycle bin unless `mode` is
 * `'permanent'`; an older server ignores the parameter and always destroys it,
 * so pass `'permanent'` when the caller means gone, and read
 * `database.recycle_bin.enabled` before telling anyone it can be undone.
 */
export function deleteFolder(
  dbId: string,
  folderId: string,
  mode?: 'recycle' | 'permanent',
): Promise<void> {
  const query = mode ? `?mode=${mode}` : ''
  return apiClient<void>(`/databases/${dbId}/folders/${folderId}${query}`, {
    method: 'DELETE',
  })
}

export function moveFolder(
  dbId: string,
  folderId: string,
  data: MoveRequest,
): Promise<FolderCompact> {
  return apiClient<FolderCompact>(`/databases/${dbId}/folders/${folderId}/move`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
