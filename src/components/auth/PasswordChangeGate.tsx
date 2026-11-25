import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChangePasswordInline } from '@/components/profile/ChangePasswordInline'
import { useAuthStore } from '@/stores/authStore'

/**
 * Shown in place of the vault while the signed-in user has to change the
 * password first (mustChangePasswordFirst), until the password is changed or
 * the user signs out.
 */
export function PasswordChangeGate() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)

  function handleChanged() {
    // The server clears the flag with the change, and this session goes on.
    if (user) setUser({ ...user, must_change_pass: false })
    void queryClient.invalidateQueries({ queryKey: ['profile'] })
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{t('passwordGate.title')}</CardTitle>
          <CardDescription>{t('passwordGate.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ChangePasswordInline onChanged={handleChanged} />
          <Button variant="outline" size="sm" className="w-full" onClick={() => logout()}>
            <LogOut />
            {t('header.logout')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
