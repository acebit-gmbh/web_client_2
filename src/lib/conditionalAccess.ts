import type { EntryWarning } from '@/api/types'

// Conditional access (Server 20.0.0+): the warning an entry's owner set in the
// Windows client, to be shown before the entry is used. The server only
// reports it - it answers the entry, the code and the document whether or not
// the warning was shown - so every decision about it is the client's, and is
// made here. Pure on purpose: the prompt renders these values, the detail
// panel and the list decide with them.

/** The three levels the client acts on. */
export type WarningLevel = 'info' | 'confirm' | 'verify'

/**
 * The level to act on. Only `info` and `confirm` are taken at their word;
 * everything else - `verify`, a level a later server adds, a value of the
 * wrong type - asks for the checkbox, so a level the client does not know
 * never opens an entry with less than the strictest prompt.
 */
export function warningLevel(warning: Pick<EntryWarning, 'level'>): WarningLevel {
  const level = warning.level
  return level === 'info' || level === 'confirm' ? level : 'verify'
}

/**
 * True when the warning must be answered before the entry is read: `confirm`,
 * `verify` and any level the client does not know. `info` is shown without
 * blocking; `null` and a missing key (a server older than 20.0.0) mean there
 * is nothing to show.
 */
export function isBlockingWarning(
  warning: EntryWarning | null | undefined,
): warning is EntryWarning {
  return warning != null && warningLevel(warning) !== 'info'
}

/**
 * What makes two warnings the same one for "was this answered?": the message,
 * the level and the checkbox text together, exactly as the server sent them.
 * A changed text or a different level is a new warning and is asked again.
 */
export function warningIdentity(warning: EntryWarning): string {
  return JSON.stringify([warning.message ?? '', warning.level ?? '', warning.verify_text ?? ''])
}

/**
 * The message as it is displayed: plain text, line breaks (the Windows client
 * stores CR LF) turned into `\n` for `whitespace-pre-wrap`, and the whitespace
 * around it dropped. Never parsed as HTML or Markdown.
 */
export function warningMessageText(warning: EntryWarning): string {
  const message = typeof warning.message === 'string' ? warning.message : ''
  return message.replace(/\r\n?/g, '\n').trim()
}

/**
 * The label of the `verify` checkbox as the entry sets it, or null when it
 * sets none and the client shows its own "I agree".
 */
export function verifyLabel(warning: EntryWarning): string | null {
  const text = typeof warning.verify_text === 'string' ? warning.verify_text.trim() : ''
  return text || null
}

/** True when the warning blocks and is not among the identities already answered. */
export function needsAnswer(
  warning: EntryWarning | null | undefined,
  answered: readonly string[],
): warning is EntryWarning {
  return isBlockingWarning(warning) && !answered.includes(warningIdentity(warning))
}

/**
 * The warning the user has to answer before the detail panel may show the
 * entry, or null. The listing's copy comes first: it is known before any
 * request, and answering it is what lets the entry be read at all. The copy in
 * the entry as read comes second, because a listing can be minutes old - a
 * blocking warning there that was not answered (a changed one, or one the
 * listing did not have yet) keeps the content hidden until it is.
 */
export function pendingWarning(
  listed: EntryWarning | null | undefined,
  fetched: EntryWarning | null | undefined,
  answered: readonly string[],
): EntryWarning | null {
  if (needsAnswer(listed, answered)) return listed
  if (needsAnswer(fetched, answered)) return fetched
  return null
}
