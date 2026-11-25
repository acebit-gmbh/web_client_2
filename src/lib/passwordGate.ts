import type { UserProfile } from '@/api/types'

/**
 * Whether the signed-in user has to change the password before the vault
 * opens: `GET /me` answers `must_change_pass` (an administrator set "must
 * change password at next logon", or the password is older than the server's
 * maximum age), the account may change its password itself (not
 * `cannot_change_pass`, not a super-administrator), and this session was
 * opened with a password. The server itself answers the other requests of
 * such a session with 403 until the password is changed.
 */
export function mustChangePasswordFirst(user: UserProfile | null | undefined, passwordSignIn: boolean): boolean {
  return (
    passwordSignIn &&
    !!user?.must_change_pass &&
    !user.cannot_change_pass &&
    !(user.roles ?? []).includes('super_admin')
  )
}
