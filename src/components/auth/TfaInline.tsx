import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ShieldCheck, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ApiError, getServerOrigin } from '@/api/client'
import { describeLoginError } from '@/lib/apiErrors'

interface TfaInlineProps {
  deliveryInfo: string
  isSetup: boolean
  qrCodeUrl?: string
  onSubmit: (code: string) => Promise<void>
  onBack: () => void
}

export function TfaInline({
  deliveryInfo,
  isSetup,
  qrCodeUrl,
  onSubmit,
  onBack,
}: TfaInlineProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit() {
    if (code.length !== 6 || isSubmitting) return
    setError(null)
    setIsSubmitting(true)

    try {
      await onSubmit(code)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? describeLoginError(err, t)
          : err instanceof Error
            ? err.message
            : t('login.unexpectedError'),
      )
      setCode('')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('tfa.backToLogin')}
      </button>

      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">{t('tfa.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('tfa.description')}</p>
      </div>

      {isSetup && qrCodeUrl && (
        <div className="space-y-2 text-center">
          <p className="text-sm text-muted-foreground">{t('tfa.scanQrCode')}</p>
          <img src={`${getServerOrigin()}${qrCodeUrl}`} alt="QR Code" className="mx-auto h-48 w-48" />
        </div>
      )}

      {!isSetup && deliveryInfo && (
        <p className="text-center text-sm text-muted-foreground">{deliveryInfo}</p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={code}
          // Authenticator apps and password managers often paste codes with
          // surrounding whitespace ("  123 456  ") or zero-width characters.
          // Strip everything that isn't a digit before storing the value so
          // a clean 6-digit code triggers onComplete reliably.
          onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
          onComplete={handleSubmit}
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} className="h-10 w-10" />
            <InputOTPSlot index={1} className="h-10 w-10" />
            <InputOTPSlot index={2} className="h-10 w-10" />
            <InputOTPSlot index={3} className="h-10 w-10" />
            <InputOTPSlot index={4} className="h-10 w-10" />
            <InputOTPSlot index={5} className="h-10 w-10" />
          </InputOTPGroup>
        </InputOTP>
      </div>

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={code.length !== 6 || isSubmitting}
        className="w-full"
        size="lg"
      >
        {isSubmitting && <Loader2 className="animate-spin" />}
        {t('tfa.verify')}
      </Button>
    </div>
  )
}
