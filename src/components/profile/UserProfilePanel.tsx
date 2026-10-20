import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { User, Shield, Loader2, Pencil, Check, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useProfile, useUpdateProfile } from '@/hooks/useProfile'
import { describeApiError } from '@/lib/apiErrors'
import type { UserProfile } from '@/api/types'
import { PasskeyList } from './PasskeyList'
import { ChangePasswordInline } from './ChangePasswordInline'

interface UserProfilePanelProps {
  open: boolean
  onClose: () => void
}

export function UserProfilePanel({ open, onClose }: UserProfilePanelProps) {
  const { t } = useTranslation()
  const { data: profile, isLoading } = useProfile()

  const canChangePassword =
    profile?.auth_modes?.includes('standard') && !profile?.cannot_change_pass

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('profile.title')}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="profile">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="profile">
              <User className="h-4 w-4" />
              {t('profile.tabProfile')}
            </TabsTrigger>
            <TabsTrigger value="security">
              <Shield className="h-4 w-4" />
              {t('profile.tabSecurity')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-4 space-y-3">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : profile ? (
              <ProfileEditForm />
            ) : null}
          </TabsContent>

          <TabsContent value="security" className="mt-4 space-y-6">
            <PasskeyList />

            {canChangePassword && (
              <>
                <Separator />
                <ChangePasswordInline />
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function ProfileEditForm() {
  const { t } = useTranslation()
  const { data: profile } = useProfile()
  const updateMut = useUpdateProfile()

  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [department, setDepartment] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (!profile) return null

  // Seed the editable fields from the loaded profile only when the user starts
  // editing; the read-only view renders directly from `profile`, so there is no
  // profile→state mirroring effect to cause cascading renders.
  function startEdit() {
    if (!profile) return
    setDisplayName(profile.display_name ?? '')
    setDepartment(profile.department ?? '')
    setPhone(profile.phone ?? '')
    setError(null)
    setSaved(false)
    setEditing(true)
  }

  function cancelEdit() {
    setDisplayName(profile?.display_name ?? '')
    setDepartment(profile?.department ?? '')
    setPhone(profile?.phone ?? '')
    setError(null)
    setEditing(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (updateMut.isPending || !profile) return

    const body: Record<string, string> = {}
    if (displayName !== (profile.display_name ?? '')) body.display_name = displayName
    if (department !== (profile.department ?? '')) body.department = department
    if (phone !== (profile.phone ?? '')) body.phone = phone

    if (Object.keys(body).length === 0) {
      setEditing(false)
      return
    }

    setError(null)
    try {
      await updateMut.mutateAsync(body)
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(describeApiError(err, t))
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved && (
        <Alert>
          <AlertDescription>{t('profile.profileSaved')}</AlertDescription>
        </Alert>
      )}

      <ProfileField label={t('profile.username')} value={profile.name} />
      <ProfileField label={t('profile.email')} value={profile.email} />

      <div className="space-y-1.5">
        <Label htmlFor="display-name" className="text-xs">
          {t('profile.displayName')}
        </Label>
        <Input
          id="display-name"
          value={editing ? displayName : (profile.display_name ?? '')}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={!editing || updateMut.isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="department" className="text-xs">
          {t('profile.department')}
        </Label>
        <Input
          id="department"
          value={editing ? department : (profile.department ?? '')}
          onChange={(e) => setDepartment(e.target.value)}
          disabled={!editing || updateMut.isPending}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone" className="text-xs">
          {t('profile.phone')}
        </Label>
        <Input
          id="phone"
          value={editing ? phone : (profile.phone ?? '')}
          onChange={(e) => setPhone(e.target.value)}
          disabled={!editing || updateMut.isPending}
        />
      </div>

      {profile.roles && profile.roles.length > 0 && (
        <>
          <Separator />
          <ProfileField label={t('profile.roles')} value={profile.roles.join(', ')} />
        </>
      )}

      {editing ? (
        <div className="flex gap-2 pt-2">
          <Button
            type="submit"
            size="sm"
            disabled={updateMut.isPending}
            className="flex-1"
          >
            {updateMut.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t('common.save')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={updateMut.isPending}
            onClick={cancelEdit}
            className="flex-1"
          >
            <X className="h-4 w-4" />
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={startEdit}
          className="mt-2 w-full"
        >
          <Pencil className="h-4 w-4" />
          {t('profile.editProfile')}
        </Button>
      )}

      {isActiveDirectoryAccount(profile) && (
        <p className="pt-1 text-xs text-muted-foreground">{t('profile.adSyncNote')}</p>
      )}
    </form>
  )
}

/**
 * Whether the account comes from Active Directory, whose sync may overwrite the
 * profile fields. `auth_modes` lists the methods the user may sign in with, not
 * the account type, so it decides only on an older server that sends no
 * `account_type`.
 */
function isActiveDirectoryAccount(profile: UserProfile): boolean {
  if (profile.account_type !== undefined) return profile.account_type === 'ad'
  return profile.auth_modes?.some((m) => m === 'sspi' || m === 'iwa') ?? false
}

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}
