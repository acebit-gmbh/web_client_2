import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToastStore, type Toast as ToastModel } from '@/stores/toastStore'

const variantStyles: Record<ToastModel['variant'], string> = {
  success: 'border-green-500/40 bg-card text-foreground',
  error: 'border-destructive/50 bg-card text-foreground',
  info: 'border-border bg-card text-foreground',
  warning: 'border-amber-500/50 bg-card text-foreground',
}

const variantIconClass: Record<ToastModel['variant'], string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-destructive',
  info: 'text-muted-foreground',
  warning: 'text-amber-600 dark:text-amber-400',
}

function VariantIcon({ variant }: { variant: ToastModel['variant'] }) {
  const className = cn('h-4 w-4 shrink-0', variantIconClass[variant])
  switch (variant) {
    case 'success':
      return <CheckCircle2 className={className} aria-hidden="true" />
    case 'error':
      return <AlertCircle className={className} aria-hidden="true" />
    case 'warning':
      return <AlertTriangle className={className} aria-hidden="true" />
    default:
      return <Info className={className} aria-hidden="true" />
  }
}

function ToastItem({ toast }: { toast: ToastModel }) {
  const { t } = useTranslation()
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    if (toast.duration <= 0) return
    const handle = setTimeout(() => dismiss(toast.id), toast.duration)
    return () => clearTimeout(handle)
  }, [toast.id, toast.duration, dismiss])

  // Errors get role="alert" so screen readers interrupt; the rest are
  // role="status" (polite live region) so they are announced without
  // breaking the user's flow.
  const role = toast.variant === 'error' ? 'alert' : 'status'

  return (
    <div
      role={role}
      aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-lg',
        'animate-in fade-in slide-in-from-right-4 duration-200',
        variantStyles[toast.variant],
      )}
    >
      <VariantIcon variant={toast.variant} />
      <div className="flex-1 space-y-0.5 text-sm">
        {toast.title && <div className="font-medium">{toast.title}</div>}
        <div className="text-muted-foreground whitespace-pre-line">{toast.message}</div>
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label={t('toast.dismiss')}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const { t } = useTranslation()
  const toasts = useToastStore((s) => s.toasts)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="region"
      aria-label={t('toast.regionLabel')}
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  )
}
