import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useTheme } from '@/hooks/useTheme'
import { useCrossTabLogout } from '@/hooks/useCrossTabLogout'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { AppBar } from '@/components/layout/AppBar'
import { PasswordChangeGate } from '@/components/auth/PasswordChangeGate'
import { Toaster } from '@/components/ui/toast'
import { mustChangePasswordFirst } from '@/lib/passwordGate'

// Route-level code splitting — unauthenticated users no longer pay for the
// vault bundle, and 404s no longer pull in either.
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const VaultPage = lazy(() => import('@/pages/VaultPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const passwordSignIn = useAuthStore((s) => s.passwordSignIn)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  // The password change comes first (until then the server answers the vault's requests with 403).
  if (mustChangePasswordFirst(user, passwordSignIn)) return <PasswordChangeGate />
  return <>{children}</>
}

// Inverse guard: a logged-in user (token survives F5 in sessionStorage) who
// lands on /login or "/" should go to their vault, not be shown a fresh login
// form (which would mint a second server session if they re-submit). The OIDC
// callback runs while still unauthenticated, so this doesn't block it.
function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (isAuthenticated) return <Navigate to="/vault" replace />
  return <>{children}</>
}

function PageFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
    </div>
  )
}

export default function App() {
  useTheme()
  useCrossTabLogout()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return (
    <ErrorBoundary>
      <div className="flex h-svh flex-col">
        <AppBar />
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicRoute>
                    <LoginPage />
                  </PublicRoute>
                }
              />
              <Route
                path="/vault/*"
                element={
                  <ProtectedRoute>
                    <VaultPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/"
                element={<Navigate to={isAuthenticated ? '/vault' : '/login'} replace />}
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </div>
      </div>
      <Toaster />
    </ErrorBoundary>
  )
}
