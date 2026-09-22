import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { createFolder, updateFolder, deleteFolder, moveFolder } from '@/api/folders'
import type { CreateFolderRequest, UpdateFolderRequest, MoveRequest } from '@/api/types'
import { useNavigationStore } from '@/stores/navigationStore'
import { useSecondPasswordStore } from '@/stores/secondPasswordStore'
import { useToast } from '@/hooks/useToast'
import { describeApiError } from '@/lib/apiErrors'

export function useCreateFolder(dbId: string) {
  const queryClient = useQueryClient()
  const currentFolderId = useNavigationStore((s) => s.currentFolderId)
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: (data: CreateFolderRequest) => createFolder(dbId, data, currentFolderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      toast.success(t('toast.folderCreated'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), {
        title: t('toast.folderCreateFailed'),
      })
    },
  })
}

export function useUpdateFolder(dbId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: ({
      folderId,
      data,
      secondPassword,
    }: {
      folderId: string
      data: UpdateFolderRequest
      secondPassword?: string
    }) => updateFolder(dbId, folderId, data, secondPassword),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      toast.success(t('toast.folderUpdated'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), {
        title: t('toast.folderUpdateFailed'),
      })
    },
  })
}

export function useDeleteFolder(dbId: string) {
  const queryClient = useQueryClient()
  const setFolder = useNavigationStore((s) => s.setFolder)
  const clearSecondPassword = useSecondPasswordStore((s) => s.clearSecondPassword)
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: (folderId: string) => deleteFolder(dbId, folderId),
    onSuccess: (_result, folderId) => {
      // The folder (and any cached second password protecting it) is gone —
      // drop the cache so a recreated folder with the same id can't be
      // unlocked with stale credentials.
      clearSecondPassword(folderId)
      setFolder(null) // Navigate to root after deleting current folder
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      // See useDeleteEntry: a deleted folder lands in the recycle bin.
      queryClient.invalidateQueries({ queryKey: ['recyclebin', dbId] })
      toast.success(t('toast.folderDeleted'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), {
        title: t('toast.folderDeleteFailed'),
      })
    },
  })
}

export function useMoveFolder(dbId: string) {
  const queryClient = useQueryClient()
  const clearSecondPassword = useSecondPasswordStore((s) => s.clearSecondPassword)
  const { t } = useTranslation()
  const toast = useToast()

  return useMutation({
    mutationFn: ({ folderId, data }: { folderId: string; data: MoveRequest }) =>
      moveFolder(dbId, folderId, data),
    onSuccess: (_result, variables) => {
      // Moving a folder can change its second-password requirement (the new
      // parent may impose its own). Drop the cache so the next access
      // re-prompts.
      clearSecondPassword(variables.folderId)
      queryClient.invalidateQueries({ queryKey: ['children', dbId] })
      queryClient.invalidateQueries({ queryKey: ['search', dbId] })
      toast.success(t('toast.folderMoved'))
    },
    onError: (err) => {
      toast.error(describeApiError(err, t), {
        title: t('toast.folderMoveFailed'),
      })
    },
  })
}
