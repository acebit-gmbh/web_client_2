import type { DatabaseIconRef, EntryDetail, EntryIconWrite } from '@/api/types'
import { isStandardIconIndex } from '@/lib/icons'

// The icon part of the entry form (Server 20.0.0+). Same rule as the
// one-time code: the request carries the icon keys ONLY when the user changed
// the icon, and then in exactly one of the three forms the server documents.
// Pure on purpose - the picker renders this state, the form turns it into
// the request body.

/**
 * What the user did to the icon in the form. `unchanged` is the state every
 * form starts in, on edit and on create alike.
 */
export type IconChoice =
  | { kind: 'unchanged' }
  /** Back to the standard icon of the entry type. */
  | { kind: 'default' }
  /** One of the 135 standard icons. */
  | { kind: 'standard'; index: number }
  /** An icon of the entry's own database, as listed or as the upload answered it. */
  | { kind: 'custom'; icon: DatabaseIconRef }

export const ICON_UNCHANGED: IconChoice = { kind: 'unchanged' }

/**
 * The icon keys for the request body, or undefined to send none of them
 * (a body without them never changes the icon).
 *
 * A database icon is named by `image_name` alone: its position in the
 * database is owned by the server, so no `image_index` is ever computed
 * here. A choice that cannot be expressed (an index outside 0..134, an empty
 * name) sends nothing rather than something the server must refuse.
 */
export function buildIconWrite(choice: IconChoice): EntryIconWrite | undefined {
  switch (choice.kind) {
    case 'unchanged':
      return undefined
    case 'default':
      return { image_custom: false, image_index: -1 }
    case 'standard':
      return isStandardIconIndex(choice.index)
        ? { image_custom: false, image_index: choice.index }
        : undefined
    case 'custom':
      return choice.icon.name ? { image_custom: true, image_name: choice.icon.name } : undefined
  }
}

/** The icon an entry has, in the picker's terms - what the picker preselects. */
export type IconSelection =
  | { kind: 'default' }
  | { kind: 'standard'; index: number }
  /** `icon` is null when the stored name no longer resolves to an icon of the database. */
  | { kind: 'custom'; name: string; icon: DatabaseIconRef | null }

type StoredIconFields = Pick<
  EntryDetail,
  'image_custom' | 'image_index' | 'image_name' | 'database_icon'
>

/**
 * The stored icon of the loaded entry. A new entry has the type default. An
 * entry whose type default was stamped by the server reads as that standard
 * icon - the two cannot be told apart, and need not be.
 */
export function storedIconSelection(entry: StoredIconFields | null | undefined): IconSelection {
  if (!entry) return { kind: 'default' }
  const icon = entry.database_icon ?? null
  if (entry.image_custom === true || icon) {
    return { kind: 'custom', name: entry.image_name || icon?.name || '', icon }
  }
  if (isStandardIconIndex(entry.image_index)) {
    return { kind: 'standard', index: entry.image_index }
  }
  return { kind: 'default' }
}

/** What the form shows and the picker highlights: the user's choice, else the stored icon. */
export function effectiveIconSelection(choice: IconChoice, stored: IconSelection): IconSelection {
  if (choice.kind === 'unchanged') return stored
  if (choice.kind === 'custom') return { kind: 'custom', name: choice.icon.name, icon: choice.icon }
  return choice
}

/** Icon names are unique per database and compared case-insensitively by the server. */
export function isSameIconName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
