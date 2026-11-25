import { useTranslation } from 'react-i18next'
import { EntryDetailField } from '../EntryDetailField'
import { calendarDayDisplay } from '@/lib/entryDates'
import type { EntryDetail } from '@/api/types'

export function IdentityDetail({ entry }: { entry: EntryDetail }) {
  const { t, i18n } = useTranslation()
  const id = entry.identity
  if (!id) return null

  return (
    <div className="space-y-4">
      <EntryDetailField label={t('entry.account')} value={id.account} copyable />
      <EntryDetailField label={t('entry.firstName')} value={id.first_name} />
      <EntryDetailField label={t('entry.lastName')} value={id.last_name} />
      <EntryDetailField
        label={t('entry.birthDate')}
        value={calendarDayDisplay(id.birth_date, i18n.language)}
      />
      <EntryDetailField label={t('entry.email')} value={id.email} copyable />
      <EntryDetailField label={t('entry.company')} value={id.company} />
      <EntryDetailField label={t('entry.phone')} value={id.phone} copyable />
      <EntryDetailField label={t('entry.mobile')} value={id.mobile} copyable />
      <EntryDetailField label={t('entry.fax')} value={id.fax} copyable />
      <EntryDetailField label={t('entry.house')} value={id.house} />
      <EntryDetailField label={t('entry.address')} value={[id.address_1, id.address_2].filter(Boolean).join(', ')} />
      <EntryDetailField label={t('entry.city')} value={[id.zip, id.city].filter(Boolean).join(' ')} />
      <EntryDetailField label={t('entry.state')} value={id.state} />
      <EntryDetailField label={t('entry.country')} value={id.country} />
      <EntryDetailField label={t('entry.website')} value={id.website} url copyable />
    </div>
  )
}
