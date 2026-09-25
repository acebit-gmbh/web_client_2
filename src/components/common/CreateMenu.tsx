import { useTranslation } from 'react-i18next'
import { Plus, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EntryIcon } from '@/components/entries/EntryIcon'
import type { EntryType } from '@/api/types'

const ENTRY_TYPES: { type: EntryType; labelKey: string }[] = [
  { type: 'password', labelKey: 'entryType.password' },
  { type: 'credit_card', labelKey: 'entryType.credit_card' },
  { type: 'license', labelKey: 'entryType.license' },
  { type: 'identity', labelKey: 'entryType.identity' },
  { type: 'information', labelKey: 'entryType.information' },
  { type: 'banking', labelKey: 'entryType.banking' },
  { type: 'document', labelKey: 'entryType.document' },
  { type: 'encrypted_file', labelKey: 'entryType.encrypted_file' },
  { type: 'certificate', labelKey: 'entryType.certificate' },
  { type: 'rdp', labelKey: 'entryType.rdp' },
  { type: 'putty', labelKey: 'entryType.putty' },
  { type: 'teamviewer', labelKey: 'entryType.teamviewer' },
]

interface CreateMenuProps {
  onNewFolder: () => void
  onNewEntry: (type: EntryType) => void
  onNewDocument: () => void
}

export function CreateMenu({ onNewFolder, onNewEntry, onNewDocument }: CreateMenuProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {t('toolbar.new')}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {/* Folder */}
        <DropdownMenuItem onClick={onNewFolder} className="gap-2">
          <Folder className="h-4 w-4 text-amber-600" />
          {t('toolbar.newFolder')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Entry types */}
        {ENTRY_TYPES.map(({ type, labelKey }) => (
          <DropdownMenuItem
            key={type}
            onClick={() => (type === 'document' ? onNewDocument() : onNewEntry(type))}
            className="gap-2"
          >
            <EntryIcon type={type} className="h-4 w-4" />
            {t(labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
