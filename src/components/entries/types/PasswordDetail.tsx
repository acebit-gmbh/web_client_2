import { useTranslation } from 'react-i18next'
import { EntryDetailField } from '../EntryDetailField'
import { CustomFieldsSection } from './CustomFieldsSection'
import type { EntryDetail } from '@/api/types'

export function PasswordDetail({ entry }: { entry: EntryDetail }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <EntryDetailField label={t('entry.login')} value={entry.login} copyable />
      <EntryDetailField label={t('entry.password')} value={entry.pass} sensitive copyable />
      {entry.url && (
        <EntryDetailField label={t('entry.url')} value={entry.url} url copyable />
      )}
      {entry.urls
        ?.filter((u) => u && u !== entry.url)
        .map((u, i) => (
          <EntryDetailField key={i} label={t('entry.url')} value={u} url copyable />
        ))}
      <CustomFieldsSection entry={entry} />
    </div>
  )
}
