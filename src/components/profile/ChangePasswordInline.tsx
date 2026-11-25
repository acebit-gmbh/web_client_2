import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { changePassword } from '@/api/auth'
import { describeApiError } from '@/lib/apiErrors'

/** onChanged runs once the server has accepted the new password. */
export function ChangePasswordInline({ onChanged }: { onChanged?: () => void | Promise<void> } = {}) {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function reset() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSubmitting) return

    if (newPassword !== confirmPassword) {
      setError(t('profile.passwordMismatch'))
      return
    }

    setError(null)
    setSuccess(false)
    setIsSubmitting(true)

    try {
      await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setSuccess(true)
      reset()
      setTimeout(() => setSuccess(false), 3000)
      await onChanged?.()
    } catch (err) {
      setError(describeApiError(err, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{t('profile.changePassword')}</h3>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{t('profile.passwordChanged')}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="current-pw" className="text-xs">{t('profile.currentPassword')}</Label>
        <Input
          id="current-pw"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-pw" className="text-xs">{t('profile.newPassword')}</Label>
        <Input
          id="new-pw"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-pw" className="text-xs">{t('profile.confirmPassword')}</Label>
        <Input
          id="confirm-pw"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      <Button
        type="submit"
        size="sm"
        disabled={!currentPassword || !newPassword || !confirmPassword || isSubmitting}
        className="w-full"
      >
        {isSubmitting && <Loader2 className="animate-spin" />}
        {t('profile.changePassword')}
      </Button>
    </form>
  )
}
