import { getServerOrigin } from '@/api/client'

/** Pattern matching standard PD icons: ico0.svg, ico1.svg, ..., ico134.svg */
const STANDARD_ICON_RE = /^ico(\d+)\.svg$/

/**
 * Highest standard icon bundled under public/icons (ico0.svg – ico134.svg).
 * Icons above this index aren't bundled and must be fetched from the server
 * /file/ endpoint instead of resolving to a 404 local path.
 */
const MAX_BUNDLED_ICON = 134

/** How many standard icons there are: `image_index` 0..134, all of them bundled. */
export const STANDARD_ICON_COUNT = MAX_BUNDLED_ICON + 1

/** True for a number that names a standard icon (`image_index` 0..134). */
export function isStandardIconIndex(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_BUNDLED_ICON
  )
}

/** File name of a standard icon, as the server spells it in `icon`. */
export function standardIconFile(index: number): string {
  return `ico${index}.svg`
}

/** True if `icon` is a standard PD icon that ships with the web client. */
function isBundledStandardIcon(icon: string): boolean {
  const match = STANDARD_ICON_RE.exec(icon)
  if (!match) return false
  return Number(match[1]) <= MAX_BUNDLED_ICON
}

/**
 * Resolve a PD icon filename to a URL.
 *
 * - Standard icons (ico0.svg – ico134.svg) are bundled with the web client
 *   and served from /icons/ — no server request needed. Server 20.0.0+ only
 *   ever sends these names. (The bundled set is coloured; the server's own
 *   /file/ copies are monochrome templates, so they are not used even there.)
 * - Any other name comes from an OLDER server (a favicon it fetched itself,
 *   `<host>.ico`) and is loaded from the PD Server at /file/<name>. The name
 *   is server data going into a URL path, so it is percent-encoded: a `/`,
 *   `?` or `#` inside it must not change which resource is requested.
 *
 * Icons stored in a database (`database_icon` on a row) are not handled
 * here — they have no URL on the server; see lib/dbIcons.ts.
 *
 * Returns undefined if no icon name is provided.
 */
export function getIconUrl(icon: string | undefined): string | undefined {
  if (!icon) return undefined

  // Standard icons are bundled locally
  if (isBundledStandardIcon(icon)) {
    return `${import.meta.env.BASE_URL}icons/${icon}`
  }

  // Legacy names — load from the PD Server
  const file = encodeURIComponent(icon)
  if (import.meta.env.DEV) {
    return `/file/${file}`
  }

  const origin = getServerOrigin()
  return `${origin}/file/${file}`
}
