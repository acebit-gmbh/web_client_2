import { useTranslation } from 'react-i18next'
import { EntryDetailField } from '../EntryDetailField'
import { customFieldDisplay } from '@/lib/customFieldValue'
import type { EntryDetail } from '@/api/types'

export function PasswordDetail({ entry }: { entry: EntryDetail }) {
  const { t, i18n } = useTranslation()

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
      {entry.custom_fields && entry.custom_fields.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('entry.customFields')}
          </div>
          {entry.custom_fields.map((field, i) => (
            <EntryDetailField
              key={i}
              label={field.name}
              value={customFieldDisplay(field, i18n.language)}
              copyable
            />
          ))}
        </div>
      )}
    </div>
  )
}
