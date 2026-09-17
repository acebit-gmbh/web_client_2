import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { createEntry, updateEntry, deleteEntry, moveEntry } from '@/api/entries'
import type { CreateEntryRequest, UpdateEntryRequest, MoveRequest } from '@/api/types'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import { useToast } from '@/hooks/useToast'
import { describeApiError, isTotpWriteRefusal } from '@/lib/apiErrors'

export function useCreateEntry(dbId: string) {
  const queryClient = useQueryClient()
  const currentFolderId = useNavigationStore((s) => s.currentFolderId)
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: (data: CreateEntryRequest) => createEntry(dbId, data, currentFolderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      toast.success(t('toast.entryCreated'))
    },
    onError: (err) => {
      // A refused one-time-code write is explained inline by the entry form,
      // in the browser's language and pointing at the field; a toast with the
      // server's wording on top would contradict it.
      if (isTotpWriteRefusal(err)) return
      toast.error(describeApiError(err, t), {
        title: t('toast.entryCreateFailed'),
      })
    },
  })
}

export function useUpdateEntry(dbId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: ({
      entryId,
      data,
      secondPassword,
    }: {
      entryId: string
      data: UpdateEntryRequest
      secondPassword?: string
    }) => updateEntry(dbId, entryId, data, secondPassword),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      queryClient.invalidateQueries({ queryKey: ['entry', dbId, variables.entryId] })
      toast.success(t('toast.entryUpdated'))
    },
    onError: (err) => {
      // See useCreateEntry: the entry form owns the message for these.
      if (isTotpWriteRefusal(err)) return
      toast.error(describeApiError(err, t), {
        title: t('toast.entryUpdateFailed'),
      })
    },
  })
}

export function useDeleteEntry(dbId: string) {
  const queryClient = useQueryClient()
  const selectEntry = useNavigationStore((s) => s.selectEntry)
  const clearSecondPassword = useSecondPasswordStore((s) => s.clearSecondPassword)
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: (entryId: string) => deleteEntry(dbId, entryId),
    onSuccess: (_result, entryId) => {
      // The entry is gone — drop any cached second password so a recreated
      // entry with the same id can't be unlocked with stale credentials.
      clearSecondPassword(entryId)
      selectEntry(null)
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      // Drop the detail cache outright so the panel can't re-open a deleted
      // entry from a still-"fresh" cache entry.
      queryClient.removeQueries({ queryKey: ['entry', dbId, entryId] })
      toast.success(t('toast.entryDeleted'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), {
        title: t('toast.entryDeleteFailed'),
      })
    },
  })
}

export function useMoveEntry(dbId: string) {
  const queryClient = useQueryClient()
  const clearSecondPassword = useSecondPasswordStore((s) => s.clearSecondPassword)
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: ({ entryId, data }: { entryId: string; data: MoveRequest }) =>
      moveEntry(dbId, entryId, data),
    onSuccess: (_result, variables) => {
      // Moving an entry can change its second-password requirement (the new
      // parent folder may impose its own). Drop the cache so the next access
      // re-prompts.
      clearSecondPassword(variables.entryId)
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      toast.success(t('toast.entryMoved'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), {
        title: t('toast.entryMoveFailed'),
      })
    },
  })
}
