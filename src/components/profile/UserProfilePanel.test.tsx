import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '@/i18n'
import { UserProfilePanel } from './UserProfilePanel'
import { useProfile, useUpdateProfile } from '@/hooks/useProfile'
import type { UserProfile } from '@/api/types'

vi.mock('@/hooks/useProfile', () => ({ useProfile: vi.fn(), useUpdateProfile: vi.fn() }))
// The Security tab's own parts fetch on their own; only whether the password form is offered
// matters here.
vi.mock('./PasskeyList', () => ({ PasskeyList: () => null }))
vi.mock('./ChangePasswordInline', () => ({
  ChangePasswordInline: () => <div data-testid="change-password" />,
}))

const useProfileMock = vi.mocked(useProfile)
const useUpdateProfileMock = vi.mocked(useUpdateProfile)

function showProfile(extra: Partial<UserProfile>) {
  const profile: UserProfile = { id: 'u1', name: 'jdoe', ...extra }
  useProfileMock.mockReturnValue({ data: profile, isLoading: false } as ReturnType<
    typeof useProfile
  >)
  render(<UserProfilePanel open onClose={() => {}} />)
}

function adNote() {
  return screen.queryByText(i18n.t('profile.adSyncNote'))
}

beforeEach(() => {
  vi.clearAllMocks()
  useUpdateProfileMock.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateProfile>)
})

/**
 * The Active Directory note warns that the next sync may overwrite the profile. `auth_modes`
 * lists the methods the policies let the user sign in with, so it does not tell the account
 * type: an AD account may be allowed passkeys only, and a Password Depot account may be
 * allowed Windows sign-in. `account_type` decides; only an older server that sends none
 * falls back to the directory words in `auth_modes`.
 */
describe('UserProfilePanel - Active Directory note', () => {
  it('shows the note for an AD account whose methods name no Windows sign-in', () => {
    showProfile({ account_type: 'ad', auth_modes: ['webauthn'] })
    expect(adNote()).toBeInTheDocument()
  })

  it('shows no note for a Password Depot account that may use Windows sign-in', () => {
    showProfile({ account_type: 'password_depot', auth_modes: ['standard', 'sspi', 'iwa'] })
    expect(adNote()).not.toBeInTheDocument()
  })

  it.each(['azure_ad', 'oidc'] as const)('shows no note for an account of type %s', (type) => {
    showProfile({ account_type: type, auth_modes: ['sspi'] })
    expect(adNote()).not.toBeInTheDocument()
  })

  it.each([['sspi'], ['iwa']])(
    'falls back to %s in auth_modes on a server without account_type',
    (mode) => {
      showProfile({ auth_modes: ['webauthn', mode] })
      expect(adNote()).toBeInTheDocument()
    },
  )

  it('shows no note on a server without account_type for a standard account', () => {
    showProfile({ auth_modes: ['standard', 'webauthn'] })
    expect(adNote()).not.toBeInTheDocument()
  })
})

describe('UserProfilePanel - password change', () => {
  function openSecurityTab() {
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('profile.tabSecurity') }))
  }

  it('offers the password change where the methods allow standard sign-in', () => {
    showProfile({ account_type: 'ad', auth_modes: ['standard', 'sspi'] })
    openSecurityTab()
    expect(screen.getByTestId('change-password')).toBeInTheDocument()
  })

  it('offers no password change where standard sign-in is not allowed', () => {
    showProfile({ account_type: 'password_depot', auth_modes: ['webauthn'] })
    openSecurityTab()
    expect(screen.queryByTestId('change-password')).not.toBeInTheDocument()
  })

  it('offers no password change where the user may not change the password', () => {
    showProfile({ auth_modes: ['standard'], cannot_change_pass: true })
    openSecurityTab()
    expect(screen.queryByTestId('change-password')).not.toBeInTheDocument()
  })
})
