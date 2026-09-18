import { vi } from 'vitest'
import { PNG_BASE64 } from '@/test/iconFixtures'

// jsdom has no image decoder and no canvas: the icon-upload tests replace
// createImageBitmap, the 2D context and the two canvas encoders with doubles
// that record what was drawn and hand back bytes chosen by the test.

/** The bytes of a real (1 x 1) PNG. */
export function pngBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))
}

/** A PNG signature followed by filler, `length` bytes in all - for the size checks. */
export function pngOfSize(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  bytes.set(pngBytes().subarray(0, Math.min(8, length)))
  return bytes
}

export const MOCK_PREVIEW_URL = `data:image/png;base64,${PNG_BASE64}`

interface CanvasMockOptions {
  /** Size of the decoded source image. */
  width?: number
  height?: number
  /** What canvas.toBlob produces; null = the encoder gave up. */
  encoded?: Uint8Array<ArrayBuffer> | null
  encodedType?: string
  /** createImageBitmap rejects (not an image). */
  decodeFails?: boolean
  /** canvas.getContext('2d') returns null. */
  noContext?: boolean
}

export function installCanvasMock(options: CanvasMockOptions = {}) {
  const { width = 200, height = 100, encodedType = 'image/png' } = options
  const encoded = options.encoded === undefined ? pngBytes() : options.encoded

  const close = vi.fn()
  const createImageBitmapMock = vi.fn(async () => {
    if (options.decodeFails) throw new DOMException('not an image', 'InvalidStateError')
    return { width, height, close }
  })
  vi.stubGlobal('createImageBitmap', createImageBitmapMock)

  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  }
  /** Every canvas a context was asked of, to check its size at the end. */
  const canvases: HTMLCanvasElement[] = []

  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(function (this: HTMLCanvasElement) {
      canvases.push(this)
      return options.noContext ? null : (context as unknown as CanvasRenderingContext2D)
    })

  const toBlob = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback: BlobCallback) => {
      callback(encoded ? new Blob([encoded], { type: encodedType }) : null)
    })

  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue(MOCK_PREVIEW_URL)

  return {
    createImageBitmap: createImageBitmapMock,
    close,
    context,
    canvases,
    getContext,
    toBlob,
    toDataURL,
    restore() {
      getContext.mockRestore()
      toBlob.mockRestore()
      toDataURL.mockRestore()
      vi.unstubAllGlobals()
    },
  }
}

/** A File of a given type; `size` overrides the real length without allocating it. */
export function imageFile(name: string, type: string, size?: number): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}
