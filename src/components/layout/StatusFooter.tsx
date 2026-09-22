import { useTranslation } from 'react-i18next'

const APP_VERSION = '2.0.1'

export function StatusFooter() {
  const { t } = useTranslation()

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t bg-muted/30 px-4 text-xs text-muted-foreground">
      <span>{t('app.name')}</span>
      <span>v{APP_VERSION}</span>
    </footer>
  )
}
