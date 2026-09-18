import { useState, type ReactNode } from 'react'
import { useDbIcon } from '@/hooks/useDbIcon'
import { useNavigationStore } from '@/stores/navigationStore'
import type { DatabaseIconRef } from '@/api/types'

interface DatabaseIconImageProps {
  /** The row's `database_icon`. Render this component only when it is non-null. */
  icon: DatabaseIconRef
  /** Database the row belongs to; defaults to the one the vault is showing. */
  dbId?: string | null
  /** Size classes, e.g. "h-5 w-5". */
  className: string
  /**
   * What to show instead: while the image loads (same box, so the layout
   * does not shift), when the icon is unusable or gone, when the browser
   * cannot decode it, and on a server without icon support. By contract this
   * is the standard icon named by the row's `icon`.
   */
  fallback: ReactNode
}

/**
 * First link of the icon chain: the item's icon from its own database. The
 * image arrives as a `data:` URL (the CSP allows `data:`, not `blob:`) and
 * is only ever the `src` of an <img>.
 *
 * Mounting it subscribes to the icon's query, so callers mount it ONLY for
 * rows that have a `database_icon`; plain rows render their fallback directly.
 */
export function DatabaseIconImage({ icon, dbId, className, fallback }: DatabaseIconImageProps) {
  const currentDatabaseId = useNavigationStore((s) => s.currentDatabaseId)
  const url = useDbIcon(dbId ?? currentDatabaseId, icon)
  // The URL that failed, not a boolean: the component instance is reused
  // when the row's icon changes, and a new image deserves its own attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (typeof url === 'string' && url !== failedUrl) {
    return (
      <img
        src={url}
        alt=""
        className={`${className} shrink-0 object-contain`}
        onError={() => setFailedUrl(url)}
      />
    )
  }
  return <>{fallback}</>
}
