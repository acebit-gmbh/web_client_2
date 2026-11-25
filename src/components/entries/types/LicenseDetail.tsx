import { useTranslation } from 'react-i18next'
import { EntryDetailField } from '../EntryDetailField'
import { calendarDayDisplay } from '@/lib/entryDates'
import type { EntryDetail } from '@/api/types'

export function LicenseDetail({ entry }: { entry: EntryDetail }) {
  const { t, i18n } = useTranslation()
  const lic = entry.license
  if (!lic) return null

  return (
    <div className="space-y-4">
      <EntryDetailField label={t('entry.product')} value={lic.product} />
      <EntryDetailField label={t('entry.version')} value={lic.version} />
      <EntryDetailField label={t('entry.regName')} value={lic.reg_name} copyable />
      <EntryDetailField label={t('entry.licenseKey')} value={lic.key_1} copyable />
      {lic.key_2 && <EntryDetailField label={t('entry.licenseKey2')} value={lic.key_2} copyable />}
      <EntryDetailField label={t('entry.url')} value={lic.url} url copyable />
      <EntryDetailField label={t('entry.login')} value={lic.user} copyable />
      <EntryDetailField label={t('entry.password')} value={lic.pass} sensitive copyable />
      <EntryDetailField
        label={t('entry.purchaseDate')}
        value={calendarDayDisplay(lic.purchase_date, i18n.language)}
      />
      <EntryDetailField label={t('entry.orderNumber')} value={lic.order_number} />
      <EntryDetailField label={t('entry.regEmail')} value={lic.reg_email} copyable />
    </div>
  )
}
