import { getSafeHref } from '@/lib/url'

// Preparing an image for `POST /databases/{db}/icons` (Server 20.0.0+).
//
// The server stores PNG only, at most 64 x 64 pixels and `icons.max_bytes`
// bytes. 64 x 64 is the native size of a Password Depot icon, so this client
// ALWAYS sends exactly that: whatever the user picks is decoded by the
// browser, drawn "contain" onto a transparent 64 x 64 canvas and re-encoded
// as PNG. There is no ladder of smaller sizes - an image that is still too
// big at 64 x 64 is refused here, before anything is sent. (A body the
// server's header stage refuses is answered without CORS headers, which a
// browser can only report as a network error.)
//
// Everything runs in the browser's own image sandbox; what leaves this module
// is a PNG the browser itself produced. SVG is never accepted as a source.
// Nothing here creates an object URL: the app's CSP allows `data:` images,
// not `blob:`.

/** Width and height of every icon this client uploads. */
export const ICON_UPLOAD_SIDE = 64

/** `icons.max_bytes` of the contract; used when the capability carries no usable number. */
export const DEFAULT_ICON_MAX_BYTES = 32768

/** Source files above this are not even read - an icon source has no reason to be this big. */
export const ICON_SOURCE_MAX_BYTES = 10 * 1024 * 1024

/** Raster types a browser decodes; deliberately without `image/svg+xml`. */
export const ICON_SOURCE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
]

/** Value of the file input's `accept` attribute. */
export const ICON_SOURCE_ACCEPT = ICON_SOURCE_TYPES.join(',')

/** The server's name rules: 1..100 characters and at most 240 UTF-8 bytes after trimming. */
export const ICON_NAME_MAX_LENGTH = 100
export const ICON_NAME_MAX_BYTES = 240

// ─── Contain fit ─────────────────────────────────────────────

export interface FitRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where a `width` x `height` image goes on a `side` x `side` square so that
 * all of it is visible, as large as possible, centred, aspect ratio kept
 * (CSS `object-fit: contain`). Whole pixels, never thinner than one. Small
 * images are enlarged: the icon is shown at 16 to 40 pixels, where a 16 x 16
 * picture left in the middle of 64 x 64 would all but disappear. Null when
 * the source has no area.
 */
export function containFit(width: number, height: number, side: number): FitRect | null {
  if (!(width > 0) || !(height > 0) || !(side > 0)) return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  const scale = Math.min(side / width, side / height)
  const w = Math.min(side, Math.max(1, Math.round(width * scale)))
  const h = Math.min(side, Math.max(1, Math.round(height * scale)))
  return { x: Math.floor((side - w) / 2), y: Math.floor((side - h) / 2), width: w, height: h }
}

// ─── Name rules ──────────────────────────────────────────────

export type IconNameProblem = 'empty' | 'tooLong' | 'tooManyBytes' | 'forbidden'

/** Code points the server refuses in a name: C0 and C1 controls, DEL, U+FFFE, U+FFFF, unpaired surrogates. */
function isForbiddenAt(text: string, index: number): boolean {
  const unit = text.charCodeAt(index)
  if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f) || unit === 0xfffe || unit === 0xffff) {
    return true
  }
  if (unit >= 0xd800 && unit <= 0xdbff) {
    const next = text.charCodeAt(index + 1)
    return !(next >= 0xdc00 && next <= 0xdfff)
  }
  if (unit >= 0xdc00 && unit <= 0xdfff) {
    const previous = index > 0 ? text.charCodeAt(index - 1) : 0
    return !(previous >= 0xd800 && previous <= 0xdbff)
  }
  return false
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * The server's admission rules for an icon name, applied to the trimmed
 * text, so a refusal is caught before the image travels. Length is counted
 * in UTF-16 units - never fewer than the server's characters, so a name
 * accepted here is accepted there. Dots, spaces, `&`, `/` and non-ASCII
 * letters are all legal: a name never reaches a URL or a file system.
 */
export function validateIconName(name: string): IconNameProblem | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  for (let i = 0; i < trimmed.length; i++) {
    if (isForbiddenAt(trimmed, i)) return 'forbidden'
  }
  if (trimmed.length > ICON_NAME_MAX_LENGTH) return 'tooLong'
  if (utf8Length(trimmed) > ICON_NAME_MAX_BYTES) return 'tooManyBytes'
  return null
}

/** `text` without the refused code points, trimmed and cut to the length rules (never inside a surrogate pair). */
export function sanitizeIconName(text: string): string {
  let clean = ''
  for (let i = 0; i < text.length; i++) {
    if (!isForbiddenAt(text, i)) clean += text[i]
  }
  // Array.from splits by code point, so a cut never separates a surrogate pair.
  const points = Array.from(clean.trim())
  let result = ''
  let bytes = 0
  for (const point of points) {
    const size = utf8Length(point)
    if (result.length + point.length > ICON_NAME_MAX_LENGTH) break
    if (bytes + size > ICON_NAME_MAX_BYTES) break
    result += point
    bytes += size
  }
  return result.trim()
}

/**
 * The name offered for a new icon: the host of the entry's URL (what the
 * Windows client and the server's own favicon action use), else the file
 * name without its extension. Only a suggestion - the user can change it,
 * and the server's answer decides the final name.
 */
export function suggestIconName(entryUrl: string | null | undefined, fileName: string): string {
  const href = getSafeHref(entryUrl)
  if (href) {
    try {
      const host = sanitizeIconName(new URL(href).hostname)
      if (host) return host
    } catch {
      // Not a URL after all: fall through to the file name.
    }
  }
  const base = fileName.replace(/\.[^.]*$/, '')
  return sanitizeIconName(base || fileName)
}

// ─── Image preparation ───────────────────────────────────────

export type IconPrepareProblem =
  /** Not one of ICON_SOURCE_TYPES (SVG, a document, ...). */
  | 'fileType'
  /** The source file is larger than ICON_SOURCE_MAX_BYTES. */
  | 'fileTooLarge'
  /** The browser cannot decode the file as an image. */
  | 'decode'
  /** This browser lacks createImageBitmap or a 2D canvas, or did not produce a PNG. */
  | 'unsupported'
  /** The 64 x 64 PNG is larger than `icons.max_bytes`. */
  | 'encodedTooLarge'

/** Carries the reason only; the UI maps it to a localized message. */
export class IconPrepareError extends Error {
  readonly problem: IconPrepareProblem

  constructor(problem: IconPrepareProblem) {
    super(`Icon not prepared: ${problem}`)
    this.name = 'IconPrepareError'
    this.problem = problem
  }
}

export interface PreparedIcon {
  /** The PNG as RFC 4648 base64 - the `data` of the upload request. */
  data: string
  /** Size of the PNG in bytes. */
  bytes: number
  /** The same picture as a `data:` URL, for the preview and for the image cache after the upload. */
  previewUrl: string
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let start = 0; start < bytes.length; start += step) {
    binary += String.fromCharCode(...bytes.subarray(start, start + step))
  }
  return btoa(binary)
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsArrayBuffer(blob)
  })
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/** `icons.max_bytes` when it is a usable number, else the contract's value. */
export function normalizeIconMaxBytes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : DEFAULT_ICON_MAX_BYTES
}

/**
 * Turns a picked file into the 64 x 64 PNG to upload. Rejects with an
 * IconPrepareError naming the reason; nothing has been sent at that point.
 */
export async function prepareIconUpload(file: File, maxBytes: unknown): Promise<PreparedIcon> {
  if (!ICON_SOURCE_TYPES.includes(file.type)) throw new IconPrepareError('fileType')
  if (file.size > ICON_SOURCE_MAX_BYTES) throw new IconPrepareError('fileTooLarge')
  if (typeof createImageBitmap !== 'function') throw new IconPrepareError('unsupported')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new IconPrepareError('decode')
  }

  const canvas = document.createElement('canvas')
  canvas.width = ICON_UPLOAD_SIDE
  canvas.height = ICON_UPLOAD_SIDE
  try {
    const rect = containFit(bitmap.width, bitmap.height, ICON_UPLOAD_SIDE)
    if (!rect) throw new IconPrepareError('decode')
    const context = canvas.getContext('2d')
    if (!context) throw new IconPrepareError('unsupported')
    context.clearRect(0, 0, ICON_UPLOAD_SIDE, ICON_UPLOAD_SIDE)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height)
  } finally {
    bitmap.close()
  }

  const blob = await encodePng(canvas)
  if (!blob) throw new IconPrepareError('unsupported')
  if (blob.size > normalizeIconMaxBytes(maxBytes)) throw new IconPrepareError('encodedTooLarge')

  const bytes = await readBytes(blob)
  // Every browser encodes PNG, but the type argument of toBlob is only a
  // request: make sure PNG is what came out before it is sent as one.
  if (!isPng(bytes)) throw new IconPrepareError('unsupported')

  const previewUrl = canvas.toDataURL('image/png')
  if (!previewUrl.startsWith('data:image/png;base64,')) throw new IconPrepareError('unsupported')

  return { data: toBase64(bytes), bytes: bytes.length, previewUrl }
}
