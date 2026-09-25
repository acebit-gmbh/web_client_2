import { useState } from 'react'
import {
  Key,
  CreditCard,
  FileText,
  UserCircle,
  Info,
  Landmark,
  File,
  FileLock2,
  FileBadge,
  Monitor,
  Terminal,
  Radio,
  Settings,
  Fingerprint,
  Folder,
  type LucideIcon,
} from 'lucide-react'
import type { DatabaseIconRef, EntryType } from '@/api/types'
import { getIconUrl } from '@/lib/icons'
import { DatabaseIconImage } from '@/components/icons/DatabaseIconImage'

const ENTRY_TYPE_ICONS: Record<EntryType | 'folder', { icon: LucideIcon; color: string }> = {
  password: { icon: Key, color: 'text-amber-600' },
  credit_card: { icon: CreditCard, color: 'text-blue-600' },
  license: { icon: FileText, color: 'text-green-600' },
  identity: { icon: UserCircle, color: 'text-indigo-600' },
  information: { icon: Info, color: 'text-cyan-600' },
  banking: { icon: Landmark, color: 'text-emerald-600' },
  document: { icon: File, color: 'text-orange-600' },
  encrypted_file: { icon: FileLock2, color: 'text-orange-600' },
  certificate: { icon: FileBadge, color: 'text-sky-600' },
  rdp: { icon: Monitor, color: 'text-purple-600' },
  putty: { icon: Terminal, color: 'text-gray-600' },
  teamviewer: { icon: Radio, color: 'text-blue-500' },
  custom: { icon: Settings, color: 'text-gray-500' },
  passkey: { icon: Fingerprint, color: 'text-violet-600' },
  folder: { icon: Folder, color: 'text-amber-600' },
}

interface EntryIconProps {
  type: EntryType | 'folder'
  /** Standard icon file name from the server (e.g. "ico12.svg"; older servers may send other names) */
  icon?: string
  /**
   * The row's `database_icon` (Server 20.0.0+): the item's icon in its own
   * database. Shown first; `icon` is then the fallback.
   */
  databaseIcon?: DatabaseIconRef | null
  /** Database the item belongs to; defaults to the one the vault is showing. */
  dbId?: string | null
  className?: string
}

/**
 * The icon chain: database icon -> bundled standard icon named by `icon` ->
 * Lucide glyph of the entry type.
 *
 * The database-icon part is a separate component mounted only when the row
 * has one: it subscribes to a query, and the (non-virtualised) entry list
 * must not carry an idle observer for every plain row.
 */
export function EntryIcon({
  type,
  icon,
  databaseIcon,
  dbId,
  className = 'h-5 w-5',
}: EntryIconProps) {
  const standard = <StandardEntryIcon type={type} icon={icon} className={className} />
  if (!databaseIcon) return standard
  return (
    <DatabaseIconImage icon={databaseIcon} dbId={dbId} className={className} fallback={standard} />
  )
}

interface StandardEntryIconProps {
  type: EntryType | 'folder'
  icon?: string
  className: string
}

function StandardEntryIcon({ type, icon, className }: StandardEntryIconProps) {
  // Track the URL that failed to load, not just a boolean. EntryIcon instances
  // are reused across entry selection, so a stale boolean would force the
  // generic fallback for every subsequently selected entry. Comparing against
  // the current URL resets the failure automatically when the icon changes.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const iconUrl = getIconUrl(icon)
  const imgFailed = failedUrl === iconUrl

  // Show server icon if available and not failed
  if (iconUrl && !imgFailed) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={`${className} shrink-0 object-contain`}
        onError={() => setFailedUrl(iconUrl)}
      />
    )
  }

  // Fallback to Lucide icon by entry type
  const config = ENTRY_TYPE_ICONS[type] ?? ENTRY_TYPE_ICONS.password
  const Icon = config.icon
  return <Icon className={`${className} shrink-0 ${config.color}`} />
}
