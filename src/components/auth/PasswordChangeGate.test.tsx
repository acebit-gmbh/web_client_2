import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import i18n from '@/i18n'
import App from '@/App'
import { queryClient } from '@/lib/queryClient'
import { mustChangePasswordFirst } from '@/lib/passwordGate'
import { useAuthStore } from '@/stores/authStore'
import { changePassword } from '@/api/auth'
import type { UserProfile } from '@/api/types'

vi.mock('@/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/auth')>()
  return { ...actual, changePassword: vi.fn(() => Promise.resolve()), logout: vi.fn(() => Promise.resolve()) }
})
vi.mock('@/lib/clipboard', () => ({ clearClipboard: vi.fn() }))
// The vault itself is not under test: a marker stands for it.
vi.mock('@/pages/VaultPage', () => ({ default: () => <div data-testid="vault" /> }))

const mina: UserProfile = { id: 'u1', name: 'mina', must_change_pass: true, cannot_change_pass: false }

function signedIn(user: UserProfile, passwordSignIn: boolean) {
  useAuthStore.setState({ token: 't', user, isAuthenticated: true, lastApiCallAt: Date.now(), passwordSignIn })
}

function renderVault() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/vault']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
  useAuthStore.setState({ token: null, user: null, isAuthenticated: false, lastApiCallAt: null, passwordSignIn: false })
})

/**
 * "Must change password at next logon", or an expired password: the server serves a session that a password sign-in
 * opened only the password change while the account must change its password, so the vault waits behind the change.
 */
describe('mustChangePasswordFirst', () => {
  it('holds a password session whose account must change its password', () => {
    expect(mustChangePasswordFirst(mina, true)).toBe(true)
  })

  it('holds no session of another sign-in method', () => {
    expect(mustChangePasswordFirst(mina, false)).toBe(false)
  })

  it('holds no account that may not change its password itself, and none without the flag', () => {
    expect(mustChangePasswordFirst({ ...mina, cannot_change_pass: true }, true)).toBe(false)
    expect(mustChangePasswordFirst({ ...mina, must_change_pass: false }, true)).toBe(false)
    expect(mustChangePasswordFirst(null, true)).toBe(false)
  })

  it('holds no super-administrator, who changes the password elsewhere, and holds another role', () => {
    expect(mustChangePasswordFirst({ ...mina, roles: ['super_admin'] }, true)).toBe(false)
    expect(mustChangePasswordFirst({ ...mina, roles: ['user_admin'] }, true)).toBe(true)
  })
})

describe('PasswordChangeGate', () => {
  it('stands in place of the vault until the password is changed, then the vault opens', async () => {
    signedIn(mina, true)
    renderVault()
    expect(await screen.findByText(i18n.t('passwordGate.title'))).toBeInTheDocument()
    expect(screen.queryByTestId('vault')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(i18n.t('profile.currentPassword')), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText(i18n.t('profile.newPassword')), { target: { value: 'new-pass-1' } })
    fireEvent.change(screen.getByLabelText(i18n.t('profile.confirmPassword')), { target: { value: 'new-pass-1' } })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('profile.changePassword') }))

    expect(await screen.findByTestId('vault')).toBeInTheDocument()
    expect(vi.mocked(changePassword)).toHaveBeenCalledWith({ current_password: 'old-pass', new_password: 'new-pass-1' })
    expect(useAuthStore.getState().user?.must_change_pass).toBe(false)
  })

  it('lets the user sign out instead', async () => {
    signedIn(mina, true)
    renderVault()
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('header.logout') }))
    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
  })

  it('does not stand in front of a session of another sign-in method', async () => {
    signedIn(mina, false)
    renderVault()
    expect(await screen.findByTestId('vault')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('passwordGate.title'))).not.toBeInTheDocument()
  })
})
