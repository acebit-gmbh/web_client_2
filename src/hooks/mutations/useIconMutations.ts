import { useMutation, useQueryClient } from '@tanstack/react-query'
import { IconUploadAnswerError, isDatabaseIconId, uploadDatabaseIcon } from '@/api/icons'
import { dbIconKey, type DbIconValue } from '@/lib/dbIcons'
import type { DatabaseIconRef } from '@/api/types'

export interface UploadIconVariables {
  /** The name the user chose; the server may store the icon under another one. */
  name: string
  /** The PNG as base64 (see prepareIconUpload). */
  data: string
  /** The same picture as a `data:` URL; becomes the cached image of the new icon. */
  previewUrl: string
}

/**
 * Stores an image in the database's icon collection and resolves to the icon
 * AS THE SERVER NAMED IT - `name` of the answer is authoritative (a different
 * picture under a taken name is stored as `name (2)`) and is what goes into
 * `image_name`.
 *
 * On success the picture the user just saw is put into the image cache under
 * the returned id and version, so the new icon shows without a download, and
 * the icon list of the database is re-read. No toast on failure: the picker
 * explains it inline (describeIconUploadError).
 *
 * The upload is a request of its own, before the entry is saved. It is not
 * undone when that save fails - REST has no icon delete; the icon stays in
 * the database, unassigned and harmless, and sending it again answers 200
 * with the same icon.
 */
export function useUploadDatabaseIcon(dbId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name, data }: UploadIconVariables): Promise<DatabaseIconRef> => {
      const result = await uploadDatabaseIcon(dbId, { name, data })
      if (typeof result?.name !== 'string' || result.name === '') throw new IconUploadAnswerError()
      return { id: result.id, name: result.name, version: result.version }
    },
    onSuccess: (icon, { previewUrl }) => {
      // Only a well-formed handle gets a cache entry; without one the image
      // is simply fetched like any other once a row refers to it.
      if (isDatabaseIconId(icon.id) && typeof icon.version === 'string' && icon.version !== '') {
        queryClient.setQueryData<DbIconValue>(dbIconKey(dbId, icon.id, icon.version), previewUrl)
      }
      void queryClient.invalidateQueries({ queryKey: ['db-icons', dbId] })
    },
  })
}
