import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getIconUrl, isStandardIconIndex, standardIconFile, STANDARD_ICON_COUNT } from './icons'
import { configureApi } from '@/api/client'

describe('getIconUrl', () => {
  beforeEach(() => {
    configureApi({
      getContext: () => ({ serverOrigin: 'https://pd.example.com:8714', token: 't' }),
      onActivity: () => {},
      onAuthFailure: () => {},
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns undefined without a name', () => {
    expect(getIconUrl(undefined)).toBeUndefined()
    expect(getIconUrl('')).toBeUndefined()
  })

  it.each(['ico0.svg', 'ico12.svg', 'ico134.svg'])(
    'serves the standard icon %s from the bundle, never from the server',
    (icon) => {
      expect(getIconUrl(icon)).toBe(`${import.meta.env.BASE_URL}icons/${icon}`)
    },
  )

  it('does not treat a number above the bundled set as bundled', () => {
    vi.stubEnv('DEV', false)
    expect(getIconUrl('ico135.svg')).toBe('https://pd.example.com:8714/file/ico135.svg')
  })

  it('keeps an ordinary legacy name readable', () => {
    vi.stubEnv('DEV', false)
    expect(getIconUrl('example.com.ico')).toBe('https://pd.example.com:8714/file/example.com.ico')
  })

  it.each([
    ['a/b.ico', 'a%2Fb.ico'],
    ['../secret.ico', '..%2Fsecret.ico'],
    ['icon?x=1#frag.ico', 'icon%3Fx%3D1%23frag.ico'],
    ['my icon & co.ico', 'my%20icon%20%26%20co.ico'],
    ['büro.ico', 'b%C3%BCro.ico'],
  ])('percent-encodes the legacy name %j so it stays one path segment', (icon, encoded) => {
    vi.stubEnv('DEV', false)
    expect(getIconUrl(icon)).toBe(`https://pd.example.com:8714/file/${encoded}`)
  })

  it('uses the dev proxy path in development, encoded the same way', () => {
    vi.stubEnv('DEV', true)
    expect(getIconUrl('a/b.ico')).toBe('/file/a%2Fb.ico')
  })
})

describe('standard icons', () => {
  it('there are 135 of them, ico0.svg to ico134.svg, and every one is bundled', () => {
    expect(STANDARD_ICON_COUNT).toBe(135)
    expect(standardIconFile(0)).toBe('ico0.svg')
    expect(standardIconFile(134)).toBe('ico134.svg')
    for (let index = 0; index < STANDARD_ICON_COUNT; index++) {
      expect(getIconUrl(standardIconFile(index))).toBe(`/icons/ico${index}.svg`)
    }
  })

  it.each([0, 1, 134])('%i is a standard icon number', (value) => {
    expect(isStandardIconIndex(value)).toBe(true)
  })

  it.each([-1, 135, 1.5, NaN, Infinity, '12', null, undefined])(
    '%j is not a standard icon number',
    (value) => {
      expect(isStandardIconIndex(value)).toBe(false)
    },
  )
})
