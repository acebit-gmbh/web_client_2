import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { EntryDetail } from '@/api/types'
import { PasswordDetail } from './types/PasswordDetail'
import { CreditCardDetail } from './types/CreditCardDetail'
import { LicenseDetail } from './types/LicenseDetail'
import { IdentityDetail } from './types/IdentityDetail'
import { InformationDetail } from './types/InformationDetail'
import { BankingDetail } from './types/BankingDetail'
import { DocumentDetail } from './types/DocumentDetail'
import { CertificateDetail } from './types/CertificateDetail'
import { EncryptedFileDetail } from './types/EncryptedFileDetail'
import { RdpDetail } from './types/RdpDetail'
import { PuttyDetail } from './types/PuttyDetail'
import { TeamViewerDetail } from './types/TeamViewerDetail'
import { PasskeyDetail } from './types/PasskeyDetail'
import { CustomFieldsSection } from './types/CustomFieldsSection'

interface EntryTypeRouterProps {
  entry: EntryDetail
}

export function EntryTypeRouter({ entry }: EntryTypeRouterProps) {
  const { t } = useTranslation()
  // Server 20.0.0: an entry of every type can hold custom fields of its own besides its type's values
  // (for example from an import); they follow the type's values. PasswordDetail shows them itself.
  // An entry without such fields shows its type's values alone.
  const withCustomFields = (detail: ReactNode) =>
    entry.custom_fields && entry.custom_fields.length > 0 ? (
      <div className="space-y-4">
        {detail}
        <CustomFieldsSection entry={entry} />
      </div>
    ) : (
      detail
    )
  switch (entry.type) {
    case 'password':
    case 'custom':
      return <PasswordDetail entry={entry} />
    case 'credit_card':
      return withCustomFields(<CreditCardDetail entry={entry} />)
    case 'license':
      return withCustomFields(<LicenseDetail entry={entry} />)
    case 'identity':
      return withCustomFields(<IdentityDetail entry={entry} />)
    case 'information':
      return withCustomFields(<InformationDetail entry={entry} />)
    case 'banking':
      return withCustomFields(<BankingDetail entry={entry} />)
    case 'document':
      return withCustomFields(<DocumentDetail entry={entry} />)
    case 'encrypted_file':
      return withCustomFields(<EncryptedFileDetail entry={entry} />)
    case 'certificate':
      return withCustomFields(<CertificateDetail entry={entry} />)
    case 'rdp':
      return withCustomFields(<RdpDetail entry={entry} />)
    case 'putty':
      return withCustomFields(<PuttyDetail entry={entry} />)
    case 'teamviewer':
      return withCustomFields(<TeamViewerDetail entry={entry} />)
    case 'passkey':
      return withCustomFields(<PasskeyDetail entry={entry} />)
    default:
      return (
        <div className="text-muted-foreground py-4 text-center text-sm">
          {t('entry.unsupportedType')}
        </div>
      )
  }
}
