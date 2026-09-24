import { useCallback, useEffect, useState } from 'react'
import { useDialogTrigger } from './useDialogTrigger'

export interface EntryBoundDialog {
  /** True only while the dialog is open AND the entry it was opened for is still selected. */
  isOpen: boolean
  open: () => void
  close: () => void
  /** The entry the open dialog belongs to, or null - never another entry. */
  entryId: string | null
}

/**
 * A dialog that belongs to the entry that was selected when it was opened -
 * the edit form. When the selection moves on, the dialog closes: Cancel on a
 * conditional-access prompt or a second-password prompt deselects the entry
 * without closing dialogs it does not own, and a dialog left armed would read
 * the NEXT selected entry at once, before that entry's own warning was
 * answered. `entryId` never names another entry, not even for the one render
 * before the effect closes the dialog, so a read keyed by it cannot start for
 * the wrong entry.
 */
export function useEntryBoundDialog(selectedEntryId: string | null): EntryBoundDialog {
  const dialog = useDialogTrigger()
  const [boundId, setBoundId] = useState<string | null>(null)
  const { isOpen: dialogOpen, open: openDialog, close } = dialog
  const isOpen = dialogOpen && boundId !== null && boundId === selectedEntryId

  const open = useCallback(() => {
    setBoundId(selectedEntryId)
    openDialog()
  }, [selectedEntryId, openDialog])

  useEffect(() => {
    if (dialogOpen && boundId !== selectedEntryId) close()
  }, [dialogOpen, boundId, selectedEntryId, close])

  return { isOpen, open, close, entryId: isOpen ? boundId : null }
}
