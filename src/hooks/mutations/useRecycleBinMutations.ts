import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { emptyRecycleBin, purgeRecycleBinItem, restoreRecycleBinItem } from '@/api/recyclebin'
import { describeApiError } from '@/lib/apiErrors'
import { useToast } from '@/hooks/useToast'

/**
 * The three writes of the recycle bin. Each invalidates the bin itself and, for
 * a restore, the listings the item reappears in.
 *
 * None of them reports success as a change to the tree beyond that: the server
 * decides what actually happened, and two of the three can do less than the
 * label suggests - a restore needs the right to change the folder the item
 * returns to, and emptying the bin silently leaves anything the caller may not
 * delete. The list is re-read after every one of them, so what is left is shown
 * rather than assumed.
 */

export function useRestoreFromRecycleBin(dbId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: (itemId: string) => restoreRecycleBinItem(dbId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recyclebin', dbId] })
      // It is back in the tree, so both listings are stale.
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      toast.success(t('toast.itemRestored'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), { title: t('toast.itemRestoreFailed') })
    },
  })
}

export function usePurgeFromRecycleBin(dbId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: (itemId: string) => purgeRecycleBinItem(dbId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recyclebin', dbId] })
      toast.success(t('toast.itemPurged'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), { title: t('toast.itemPurgeFailed') })
    },
  })
}

export function useEmptyRecycleBin(dbId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: () => emptyRecycleBin(dbId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recyclebin', dbId] })
      // Deliberately not "the recycle bin is empty": the server keeps whatever
      // this caller may not delete, and answers 204 either way.
      toast.success(t('toast.recycleBinEmptied'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), { title: t('toast.recycleBinEmptyFailed') })
    },
  })
}
