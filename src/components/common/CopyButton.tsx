import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'

interface CopyButtonProps {
  value: string
  label?: string
  /** Overrides the user's clipboard auto-clear setting (milliseconds). */
  autoClearMs?: number
}

export function CopyButton({ value, label, autoClearMs }: CopyButtonProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(value, autoClearMs)
      setFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      setFailed(true)
      setTimeout(() => setFailed(false), 2000)
    }
  }, [value, autoClearMs])

  const icon = copied ? (
    <Check className="h-3 w-3" />
  ) : failed ? (
    <X className="h-3 w-3 text-destructive" />
  ) : (
    <Copy className="h-3 w-3" />
  )

  return (
    <Button variant="outline" size="xs" onClick={handleCopy} className="gap-1">
      {icon}
      {label ?? (copied || failed ? '' : t('common.copy'))}
    </Button>
  )
}
