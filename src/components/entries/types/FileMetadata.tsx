import { useTranslation } from 'react-i18next'
import { EntryDetailField } from '../EntryDetailField'
import { formatBytes } from '@/lib/format'
import type { CertificateFields, DocumentFields } from '@/api/types'

export function FileMetadata({ file }: { file: DocumentFields | null | undefined }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <EntryDetailField label={t('entry.fileName')} value={file?.name} />
      <EntryDetailField label={t('entry.fileType')} value={file?.type} />
      <EntryDetailField
        label={t('entry.fileSize')}
        value={file?.size === undefined ? undefined : formatBytes(file.size)}
      />
    </div>
  )
}

/** Derived values from the server; never copied into a POST or PATCH body. */
export function CertificateMetadata({ certificate }: { certificate: CertificateFields }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <EntryDetailField
        label={t('entry.certificate.subject')}
        value={certificate.subject}
        copyable
      />
      <EntryDetailField label={t('entry.certificate.issuer')} value={certificate.issuer} copyable />
      <EntryDetailField label={t('entry.certificate.validFrom')} value={certificate.valid_from} />
      <EntryDetailField label={t('entry.certificate.validTo')} value={certificate.valid_to} />
      <EntryDetailField
        label={t('entry.certificate.thumbprint')}
        value={certificate.thumbprint}
        copyable
      />
    </div>
  )
}
