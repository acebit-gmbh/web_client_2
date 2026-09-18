import type { DatabaseCompact, DatabaseIcon, DatabaseIconsCapability } from '@/api/types'

// Shared fixtures for the database-icon tests (ES-997).

/** A real 1x1 PNG, base64 as the server sends it (no `data:` prefix). */
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

/** The capability object of the frozen contract. */
export const ICON_CAPABILITY: DatabaseIconsCapability = {
  can_upload: true,
  accepted_types: ['image/png'],
  max_bytes: 32768,
  max_side: 64,
  max_count: 1024,
  batch_max: 32,
}

export function database(id: string, icons?: DatabaseIconsCapability): DatabaseCompact {
  return {
    id,
    name: `Database ${id}`,
    description: '',
    updated_at: '2026-01-01T00:00:00Z',
    ...(icons ? { icons } : {}),
  }
}

/** What GET /databases answers, as the `['databases']` query caches it. */
export function databasesResponse(...databases: DatabaseCompact[]) {
  return { data: databases, total: databases.length, offset: 0, limit: 200 }
}

/** A batch / item-route icon with `state: ok` and a PNG. */
export function okIcon(
  id: string,
  version = `v${id}`,
  extra: Partial<DatabaseIcon> = {},
): DatabaseIcon {
  return {
    id,
    name: `icon-${id}`,
    version,
    state: 'ok',
    content_type: 'image/png',
    width: 1,
    height: 1,
    data: PNG_BASE64,
    ...extra,
  }
}

/** The list envelope around batch items. */
export function iconsResponse(...icons: DatabaseIcon[]) {
  return { data: icons, total: icons.length, offset: 0, limit: icons.length }
}
