import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Lock } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { describeEntryReadError } from '@/lib/apiErrors'

interface SecondPasswordPromptProps {
  open: boolean
  onClose: () => void
  entryName: string
  entryType: string
  onSubmit: (password: string) => Promise<void>
}

export function SecondPasswordPrompt({
  open,
  onClose,
  entryName,
  entryType,
  onSubmit,
}: SecondPasswordPromptProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || isSubmitting) return
    setError(null)
    setIsSubmitting(true)

    try {
      await onSubmit(password)
    } catch (err) {
      setError(describeEntryReadError(err, t))
      setPassword('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose()
          setPassword('')
          setError(null)
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-amber-50">
            <Lock className="h-5 w-5 text-amber-600" />
          </div>
          <DialogTitle className="text-center">{t('secondPassword.title')}</DialogTitle>
          <DialogDescription className="text-center">
            <span className="font-medium text-foreground">{entryName}</span>
            <br />
            {entryType} · {t('secondPassword.protected')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="second-password">{t('secondPassword.label')}</Label>
            <Input
              id="second-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" className="flex-1" disabled={!password || isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {t('secondPassword.unlock')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
