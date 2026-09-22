import { useTranslation } from 'react-i18next'

// Substituted at build time from package.json; see src/vite-env.d.ts.
const APP_VERSION = __APP_VERSION__

export function StatusFooter() {
  const { t } = useTranslation()

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t bg-muted/30 px-4 text-xs text-muted-foreground">
      <span>{t('app.name')}</span>
      <span>v{APP_VERSION}</span>
    </footer>
  )
}
