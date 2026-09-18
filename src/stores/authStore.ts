import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UserProfile } from '@/api/types'
import { useSecondPasswordStore } from './secondPasswordStore'
import { useTotpCapabilityStore } from './totpCapabilityStore'
import { useNavigationStore } from './navigationStore'
import { useConnectionStore } from './connectionStore'
import { clearClipboard } from '@/lib/clipboard'
import { queryClient } from '@/lib/queryClient'
import { dbIconBatcher } from '@/lib/dbIcons'
import { logout as apiLogout } from '@/api/auth'

const AUTH_STORAGE_KEY = 'pd-auth'
/** Per-user "last opened database" pointer (set in VaultPage). */
const LAST_DB_KEY = 'pd-last-db'

export interface LogoutOptions {
  /**
   * Fan the logout out to other tabs via BroadcastChannel. Only true for an
   * explicit user sign-out — a per-tab event (auto-lock, this tab's session
   * expiry, a 401) must NOT log other tabs out of their own live sessions.
   */
  broadcast?: boolean
  /**
   * Revoke the token server-side via POST /auth/logout. Skipped when the token
   * is already dead (401 handler, server-side inactivity expiry) to avoid a
   * pointless re-auth-failure; done for explicit sign-out and auto-lock so a
   * leaked bearer token can't outlive the client session.
   */
  revoke?: boolean
}

// Cross-tab logout channel. sessionStorage does not raise `storage` events
// across tabs (it is tab-scoped), so we use BroadcastChannel to fan-out the
// logout signal. Guarded for environments where it doesn't exist (older
// browsers, jsdom in tests).
const authChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pd-auth') : null

interface AuthState {
  token: string | null
  user: UserProfile | null
  isAuthenticated: boolean
  lastApiCallAt: number | null

  setToken: (token: string) => void
  setAuth: (token: string, user: UserProfile) => void
  logout: (options?: LogoutOptions) => void
  resetSessionTimer: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      lastApiCallAt: null,

      setToken: (token) => set({ token }),

      setAuth: (token, user) =>
        set({
          token,
          user,
          isAuthenticated: true,
          lastApiCallAt: Date.now(),
        }),

      logout: (options) => {
        const { broadcast = true, revoke = true } = options ?? {}

        // Revoke the session server-side BEFORE clearing local state so
        // apiClient can still read the (valid) token when building the
        // request. Fire-and-forget: a leaked bearer token must not outlive the
        // client session. Skipped when the token is already dead to avoid a
        // re-auth-failure loop (the 401 handler calls logout with revoke:false).
        const { token } = get()
        if (revoke && token) {
          apiLogout().catch(() => {
            // Already expired / offline — nothing more we can do.
          })
        }

        useSecondPasswordStore.getState().clearAll()
        // The next login may be to another server: forget what this one said
        // about one-time-code writes.
        useTotpCapabilityStore.getState().clearAll()
        // Wipe any password / sensitive data still on the OS clipboard so a
        // 30-second auto-clear window doesn't outlive the session.
        clearClipboard()
        // When a different user logs in next, they must not see anything
        // cached from the previous session: navigation pointers, query
        // results, IdP provider lists, etc. Cancel in-flight requests first
        // so a late response can't repopulate the cache after we've cleared
        // it (the now-invalid token would 401 anyway, but be defensive).
        useNavigationStore.getState().reset()
        useConnectionStore.getState().disconnect()
        queryClient.cancelQueries()
        queryClient.clear()
        // The icon loader queues requests of its own; drop them, and make it
        // ignore answers still on their way, so nothing of this session is
        // fetched with - or cached for - the next one.
        dbIconBatcher.reset()
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          lastApiCallAt: null,
        })
        // Belt-and-braces: persist writes the cleared state, but we also
        // remove the key so a tab opened from history can't rehydrate any
        // residual blob.
        try {
          sessionStorage.removeItem(AUTH_STORAGE_KEY)
        } catch {
          // sessionStorage may be unavailable (privacy mode); ignore.
        }
        // The "last opened database" pointer is not user-scoped; clearing it
        // stops the next user on a shared machine from being dropped into the
        // previous user's database.
        try {
          localStorage.removeItem(LAST_DB_KEY)
        } catch {
          // ignore
        }
        if (broadcast) authChannel?.postMessage({ type: 'logout' })
      },

      resetSessionTimer: () => set({ lastApiCallAt: Date.now() }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
)

export { authChannel }
