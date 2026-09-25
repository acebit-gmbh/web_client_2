import { useTranslation } from 'react-i18next'
import { EntryDetailField } from '../EntryDetailField'
import type { EntryDetail } from '@/api/types'

export function EncryptedFileDetail({ entry }: { entry: EntryDetail }) {
  const { t } = useTranslation()
  const file = entry.encrypted_file
  if (!file) return null
  return (
    <div className="space-y-4">
      <EntryDetailField label={t('entry.password')} value={file.pass} sensitive copyable />
      <p className="text-muted-foreground text-sm">{t('fileEntry.referencesHint')}</p>
      <ul aria-label={t('fileEntry.references')} className="space-y-4">
        {(file.files ?? []).map((reference, index) => (
          <li key={index} className="space-y-2">
            <EntryDetailField label={t('entry.fileName')} value={reference.name} />
            <EntryDetailField label={t('fileEntry.path')} value={reference.path} copyable />
          </li>
        ))}
      </ul>
    </div>
  )
}
