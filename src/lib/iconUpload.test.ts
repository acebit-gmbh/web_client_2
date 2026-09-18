import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  containFit,
  DEFAULT_ICON_MAX_BYTES,
  ICON_SOURCE_ACCEPT,
  ICON_SOURCE_MAX_BYTES,
  ICON_UPLOAD_SIDE,
  IconPrepareError,
  normalizeIconMaxBytes,
  prepareIconUpload,
  sanitizeIconName,
  suggestIconName,
  validateIconName,
} from './iconUpload'
import { PNG_BASE64 } from '@/test/iconFixtures'
import {
  imageFile,
  installCanvasMock,
  MOCK_PREVIEW_URL,
  pngBytes,
  pngOfSize,
} from '@/test/canvasMock'

/** A character by code: control characters and lone surrogates never appear literally in this file. */
const ch = (code: number) => String.fromCharCode(code)

describe('containFit', () => {
  it.each([
    // [source w, source h, expected rect on 64 x 64]
    [64, 64, { x: 0, y: 0, width: 64, height: 64 }],
    [200, 100, { x: 0, y: 16, width: 64, height: 32 }],
    [100, 200, { x: 16, y: 0, width: 32, height: 64 }],
    [100, 300, { x: 21, y: 0, width: 21, height: 64 }],
    [1920, 1080, { x: 0, y: 14, width: 64, height: 36 }],
    // Small sources are enlarged to fill the square.
    [16, 16, { x: 0, y: 0, width: 64, height: 64 }],
    [32, 16, { x: 0, y: 16, width: 64, height: 32 }],
    // An extreme strip keeps at least one pixel.
    [4000, 1, { x: 0, y: 31, width: 64, height: 1 }],
    [1, 4000, { x: 31, y: 0, width: 1, height: 64 }],
  ])('%i x %i', (width, height, expected) => {
    expect(containFit(width, height, 64)).toEqual(expected)
  })

  it('never leaves the square', () => {
    for (const [w, h] of [
      [3, 7],
      [7, 3],
      [63, 65],
      [65, 63],
      [1000, 999],
    ]) {
      const rect = containFit(w, h, 64)!
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(64)
      expect(rect.y + rect.height).toBeLessThanOrEqual(64)
      expect(Math.max(rect.width, rect.height)).toBe(64)
    }
  })

  it.each([
    [0, 10],
    [10, 0],
    [-5, 10],
    [NaN, 10],
    [Infinity, 10],
  ])('a source without area (%d x %d) has no rect', (width, height) => {
    expect(containFit(width, height, 64)).toBeNull()
  })
})

describe('validateIconName', () => {
  it.each([
    'example.com',
    'mail.google.com',
    'logo.png',
    'x (2)',
    'Bank & Co',
    'Büro – Zürich',
    'file',
    'a/b',
    '..',
    '日本語',
    '😀',
    'a'.repeat(100),
    '  padded  ',
  ])('accepts %j', (name) => {
    expect(validateIconName(name)).toBeNull()
  })

  it.each(['', '   ', '\t\n'])('refuses the empty name %j', (name) => {
    expect(validateIconName(name)).toBe('empty')
  })

  it('refuses more than 100 characters, counted after trimming', () => {
    expect(validateIconName('a'.repeat(101))).toBe('tooLong')
    expect(validateIconName(` ${'a'.repeat(100)} `)).toBeNull()
  })

  it('refuses more than 240 UTF-8 bytes even within 100 characters', () => {
    // 80 x 3 bytes = 240: the limit itself is fine, one more is not.
    expect(validateIconName('日'.repeat(80))).toBeNull()
    expect(validateIconName('日'.repeat(81))).toBe('tooManyBytes')
  })

  it.each([
    ['U+0001', `a${ch(0x01)}b`],
    ['a tab inside', 'a\tb'],
    ['DEL', `a${ch(0x7f)}b`],
    ['U+0085', `a${ch(0x85)}b`],
    ['U+009F', `a${ch(0x9f)}b`],
    ['U+FFFE', `a${ch(0xfffe)}b`],
    ['U+FFFF', `a${ch(0xffff)}b`],
    ['a lone high surrogate', `a${ch(0xd83d)}b`],
    ['a lone low surrogate', `a${ch(0xde00)}b`],
    ['a high surrogate at the end', `ab${ch(0xd83d)}`],
  ])('refuses %s', (_what, name) => {
    expect(validateIconName(name)).toBe('forbidden')
  })
})

describe('sanitizeIconName', () => {
  it('drops refused code points and trims', () => {
    expect(sanitizeIconName(`  my${ch(0x00)} logo${ch(0x85)}${ch(0xd83d)}  `)).toBe('my logo')
  })

  it('cuts to 100 characters without splitting a surrogate pair', () => {
    const cut = sanitizeIconName(`${'a'.repeat(99)}😀b`)
    expect(cut).toBe('a'.repeat(99))
    expect(validateIconName(cut)).toBeNull()
  })

  it('cuts to 240 UTF-8 bytes', () => {
    const cut = sanitizeIconName('日'.repeat(90))
    expect(cut).toBe('日'.repeat(80))
    expect(validateIconName(cut)).toBeNull()
  })

  it('whatever it returns passes the name rules (or is empty)', () => {
    for (const text of [
      `${ch(0x01)}${ch(0x02)}`,
      ' ',
      'ok',
      `${'é'.repeat(130)}`,
      'a'.repeat(500),
    ]) {
      const clean = sanitizeIconName(text)
      if (clean !== '') expect(validateIconName(clean)).toBeNull()
    }
  })
})

describe('suggestIconName', () => {
  it.each([
    ['https://www.example.com/login?x=1', 'logo.png', 'www.example.com'],
    ['example.com/path', 'logo.png', 'example.com'],
    ['intranet:8714', 'logo.png', 'intranet'],
    ['HTTPS://Mail.Example.COM', 'logo.png', 'mail.example.com'],
  ])('uses the host of the entry URL %j', (url, fileName, expected) => {
    expect(suggestIconName(url, fileName)).toBe(expected)
  })

  it.each([
    [undefined, 'logo.png', 'logo'],
    [null, 'My Bank.final.jpeg', 'My Bank.final'],
    ['', 'logo', 'logo'],
    ['   ', '.png', '.png'],
    ['javascript:alert(1)', 'logo.png', 'logo'],
    ['not a url at all', 'logo.png', 'logo'],
  ])('falls back to the file base name (url %j, file %j)', (url, fileName, expected) => {
    expect(suggestIconName(url, fileName)).toBe(expected)
  })

  it('sanitises the file name too', () => {
    expect(suggestIconName(null, `${'x'.repeat(150)}.png`)).toBe('x'.repeat(100))
  })
})

describe('normalizeIconMaxBytes', () => {
  it('takes the published number', () => {
    expect(normalizeIconMaxBytes(32768)).toBe(32768)
    expect(normalizeIconMaxBytes(1000.9)).toBe(1000)
  })

  it.each([undefined, null, '32768', NaN, Infinity, 0, -1])(
    'falls back to the contract value for %j',
    (value) => {
      expect(normalizeIconMaxBytes(value)).toBe(DEFAULT_ICON_MAX_BYTES)
      expect(DEFAULT_ICON_MAX_BYTES).toBe(32768)
    },
  )
})

describe('prepareIconUpload', () => {
  let mock: ReturnType<typeof installCanvasMock> | undefined

  afterEach(() => {
    mock?.restore()
    mock = undefined
  })

  async function problemOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
    } catch (err) {
      expect(err).toBeInstanceOf(IconPrepareError)
      return (err as IconPrepareError).problem
    }
    throw new Error('expected a rejection')
  }

  it('offers raster types only - never SVG', () => {
    expect(ICON_SOURCE_ACCEPT).toBe('image/png,image/jpeg,image/gif,image/webp,image/bmp')
    expect(ICON_SOURCE_ACCEPT).not.toContain('svg')
  })

  it('draws the image contain-fit on a transparent 64 x 64 canvas and encodes PNG', async () => {
    mock = installCanvasMock({ width: 200, height: 100 })
    const file = imageFile('logo.jpg', 'image/jpeg')

    const prepared = await prepareIconUpload(file, 32768)

    expect(mock.createImageBitmap).toHaveBeenCalledTimes(1)
    expect(mock.createImageBitmap).toHaveBeenCalledWith(file)
    expect(mock.canvases).toHaveLength(1)
    expect(mock.canvases[0].width).toBe(64)
    expect(mock.canvases[0].height).toBe(64)
    expect(ICON_UPLOAD_SIDE).toBe(64)
    // Cleared, not filled: the margins stay transparent.
    expect(mock.context.clearRect).toHaveBeenCalledWith(0, 0, 64, 64)
    expect(mock.context.drawImage).toHaveBeenCalledTimes(1)
    const [, x, y, w, h] = mock.context.drawImage.mock.calls[0]
    expect([x, y, w, h]).toEqual([0, 16, 64, 32])
    expect(mock.toBlob).toHaveBeenCalledTimes(1)
    expect(mock.toBlob.mock.calls[0][1]).toBe('image/png')
    expect(mock.close).toHaveBeenCalledTimes(1)

    // `data` is exactly the encoded bytes, as padded base64 without a prefix.
    expect(prepared.data).toBe(PNG_BASE64)
    expect(prepared.bytes).toBe(pngBytes().length)
    expect(mock.toDataURL).toHaveBeenCalledWith('image/png')
    expect(prepared.previewUrl).toBe(MOCK_PREVIEW_URL)
  })

  it('enlarges a small source to the full 64 x 64', async () => {
    mock = installCanvasMock({ width: 16, height: 16 })
    await prepareIconUpload(imageFile('favicon.png', 'image/png'), 32768)
    const [, x, y, w, h] = mock.context.drawImage.mock.calls[0]
    expect([x, y, w, h]).toEqual([0, 0, 64, 64])
  })

  it('accepts a PNG of exactly max_bytes', async () => {
    mock = installCanvasMock({ encoded: pngOfSize(32768) })
    const prepared = await prepareIconUpload(imageFile('a.png', 'image/png'), 32768)
    expect(prepared.bytes).toBe(32768)
    // 32768 bytes are 43692 base64 characters - the server's text limit.
    expect(prepared.data).toHaveLength(43692)
  })

  it('refuses locally when the 64 x 64 PNG exceeds max_bytes - no ladder of smaller sizes', async () => {
    mock = installCanvasMock({ encoded: pngOfSize(32769) })

    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 32768))).toBe(
      'encodedTooLarge',
    )
    // One decode, one canvas, one encode: nothing was tried at 48 or 32 pixels.
    expect(mock.createImageBitmap).toHaveBeenCalledTimes(1)
    expect(mock.toBlob).toHaveBeenCalledTimes(1)
    expect(mock.canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([[64, 64]])
  })

  it('uses the max_bytes the database publishes, and the contract value for a useless one', async () => {
    mock = installCanvasMock({ encoded: pngOfSize(101) })
    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 100))).toBe(
      'encodedTooLarge',
    )
    await expect(prepareIconUpload(imageFile('a.png', 'image/png'), 101)).resolves.toBeTruthy()
    await expect(prepareIconUpload(imageFile('a.png', 'image/png'), 'many')).resolves.toBeTruthy()
  })

  it.each([
    ['an SVG', 'logo.svg', 'image/svg+xml'],
    ['an icon file', 'favicon.ico', 'image/x-icon'],
    ['a document', 'logo.pdf', 'application/pdf'],
    ['a file of unknown type', 'logo', ''],
    ['a TIFF', 'logo.tif', 'image/tiff'],
  ])('refuses %s before decoding anything', async (_what, name, type) => {
    mock = installCanvasMock()
    expect(await problemOf(prepareIconUpload(imageFile(name, type), 32768))).toBe('fileType')
    expect(mock.createImageBitmap).not.toHaveBeenCalled()
  })

  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'])(
    'reads a %s source',
    async (type) => {
      mock = installCanvasMock()
      await expect(prepareIconUpload(imageFile('logo', type), 32768)).resolves.toBeTruthy()
    },
  )

  it('refuses an oversized source file without reading it', async () => {
    mock = installCanvasMock()
    const file = imageFile('huge.png', 'image/png', ICON_SOURCE_MAX_BYTES + 1)
    expect(await problemOf(prepareIconUpload(file, 32768))).toBe('fileTooLarge')
    expect(mock.createImageBitmap).not.toHaveBeenCalled()

    const atLimit = imageFile('big.png', 'image/png', ICON_SOURCE_MAX_BYTES)
    await expect(prepareIconUpload(atLimit, 32768)).resolves.toBeTruthy()
  })

  it('reports a file the browser cannot decode', async () => {
    mock = installCanvasMock({ decodeFails: true })
    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 32768))).toBe(
      'decode',
    )
    expect(mock.toBlob).not.toHaveBeenCalled()
  })

  it('reports a decoded image without area, and still releases the bitmap', async () => {
    mock = installCanvasMock({ width: 0, height: 0 })
    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 32768))).toBe(
      'decode',
    )
    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('reports a browser without createImageBitmap', async () => {
    mock = installCanvasMock()
    vi.stubGlobal('createImageBitmap', undefined)
    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 32768))).toBe(
      'unsupported',
    )
  })

  it('reports a browser without a 2D canvas, and still releases the bitmap', async () => {
    mock = installCanvasMock({ noContext: true })
    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 32768))).toBe(
      'unsupported',
    )
    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('reports an encoder that produced nothing', async () => {
    mock = installCanvasMock({ encoded: null })
    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 32768))).toBe(
      'unsupported',
    )
  })

  it('never sends bytes that are not a PNG, whatever the blob calls itself', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
    mock = installCanvasMock({ encoded: jpeg, encodedType: 'image/png' })
    expect(await problemOf(prepareIconUpload(imageFile('a.png', 'image/png'), 32768))).toBe(
      'unsupported',
    )
  })

  it('never creates an object URL (the CSP allows data:, not blob:)', async () => {
    mock = installCanvasMock()
    const createObjectURL = vi.fn(() => 'blob:nope')
    const original = URL.createObjectURL
    URL.createObjectURL = createObjectURL
    try {
      const prepared = await prepareIconUpload(imageFile('a.png', 'image/png'), 32768)
      expect(createObjectURL).not.toHaveBeenCalled()
      expect(prepared.previewUrl.startsWith('data:image/png;base64,')).toBe(true)
    } finally {
      URL.createObjectURL = original
    }
  })
})
