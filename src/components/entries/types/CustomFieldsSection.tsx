import { useTranslation } from 'react-i18next'
import { EntryDetailField } from '../EntryDetailField'
import { customFieldDisplay } from '@/lib/customFieldValue'
import type { EntryDetail } from '@/api/types'

/**
 * The custom fields of an entry, in the order the server sends them. Server 20.0.0 sends them for an entry of
 * every type but an encrypted file: for a credit card, an identity and the other typed entries, the fields the
 * entry holds besides its type's values (for example from an import). A field the server stores as a secret is
 * masked until the user reveals it.
 */
export function CustomFieldsSection({ entry }: { entry: EntryDetail }) {
  const { t, i18n } = useTranslation()
  if (!entry.custom_fields || entry.custom_fields.length === 0) return null
  const booleanWords = { true: t('entry.customFieldTrue'), false: t('entry.customFieldFalse') }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('entry.customFields')}
      </div>
      {entry.custom_fields.map((field, i) => (
        <EntryDetailField
          key={i}
          label={field.name}
          value={customFieldDisplay(field, i18n.language, booleanWords)}
          sensitive={field.secret === true}
          copyable
        />
      ))}
    </div>
  )
}
