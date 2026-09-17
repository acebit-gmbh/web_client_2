import { create } from 'zustand'

/**
 * Per-database verdict "this server accepts one-time-code writes" (WCL-43),
 * learned from the first entry row seen in a listing: Server 20.0.0+ puts a
 * `totp` object on every entry, older servers omit it. The verdict cannot
 * be probed by writing (unknown request keys are ignored silently), so the
 * form hides its editor until a row has been seen. Kept here rather than in
 * the query cache so an empty folder or a fresh search does not forget it.
 */
interface TotpCapabilityState {
  verdicts: Record<string, boolean>
  record: (dbId: string, supported: boolean) => void
  clearAll: () => void
}

export const useTotpCapabilityStore = create<TotpCapabilityState>((set, get) => ({
  verdicts: {},

  record: (dbId, supported) => {
    if (get().verdicts[dbId] === supported) return
    set((state) => ({ verdicts: { ...state.verdicts, [dbId]: supported } }))
  },

  clearAll: () => set({ verdicts: {} }),
}))
