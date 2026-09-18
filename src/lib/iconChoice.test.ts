import { describe, it, expect } from 'vitest'
import {
  buildIconWrite,
  effectiveIconSelection,
  ICON_UNCHANGED,
  isSameIconName,
  storedIconSelection,
  type IconChoice,
} from './iconChoice'
import type { DatabaseIconRef } from '@/api/types'

const REF: DatabaseIconRef = { id: '7', name: 'example.com', version: 'v7' }

describe('buildIconWrite', () => {
  it('unchanged: sends none of the icon keys', () => {
    expect(buildIconWrite(ICON_UNCHANGED)).toBeUndefined()
  })

  it('default: image_custom false with image_index -1', () => {
    expect(buildIconWrite({ kind: 'default' })).toEqual({ image_custom: false, image_index: -1 })
  })

  it.each([0, 12, 134])('standard %i: image_custom false with that number', (index) => {
    expect(buildIconWrite({ kind: 'standard', index })).toEqual({
      image_custom: false,
      image_index: index,
    })
  })

  it('custom: image_custom true with the name - and never a position', () => {
    const write = buildIconWrite({ kind: 'custom', icon: REF })
    expect(write).toEqual({ image_custom: true, image_name: 'example.com' })
    expect(write).not.toHaveProperty('image_index')
  })

  it('keeps a name the server made unique exactly as answered', () => {
    const icon = { ...REF, name: 'Bank & Co (2)' }
    expect(buildIconWrite({ kind: 'custom', icon })).toEqual({
      image_custom: true,
      image_name: 'Bank & Co (2)',
    })
  })

  it.each([-1, 135, 9999, 1.5, NaN])(
    'a standard number the server would refuse (%d) sends nothing',
    (index) => {
      expect(buildIconWrite({ kind: 'standard', index })).toBeUndefined()
    },
  )

  it('a database icon without a name sends nothing', () => {
    expect(buildIconWrite({ kind: 'custom', icon: { ...REF, name: '' } })).toBeUndefined()
  })
})

describe('storedIconSelection', () => {
  it('a new entry has the type default', () => {
    expect(storedIconSelection(undefined)).toEqual({ kind: 'default' })
    expect(storedIconSelection(null)).toEqual({ kind: 'default' })
  })

  it('a database icon is preselected with its reference', () => {
    expect(
      storedIconSelection({
        image_custom: true,
        image_index: 3,
        image_name: 'example.com',
        database_icon: REF,
      }),
    ).toEqual({ kind: 'custom', name: 'example.com', icon: REF })
  })

  it('a stored name that no longer resolves keeps the name and has no reference', () => {
    expect(
      storedIconSelection({
        image_custom: true,
        image_index: 3,
        image_name: 'gone.example',
        database_icon: null,
      }),
    ).toEqual({ kind: 'custom', name: 'gone.example', icon: null })
  })

  it('a legacy custom icon without a stored name takes the name of what it resolves to', () => {
    expect(
      storedIconSelection({
        image_custom: true,
        image_index: 3,
        image_name: '',
        database_icon: REF,
      }),
    ).toEqual({ kind: 'custom', name: 'example.com', icon: REF })
  })

  it.each([0, 12, 134])('standard icon %i is preselected by number', (index) => {
    expect(
      storedIconSelection({ image_custom: false, image_index: index, database_icon: null }),
    ).toEqual({ kind: 'standard', index })
  })

  it('never reads the server-maintained position of a database icon as a standard icon', () => {
    const stored = storedIconSelection({
      image_custom: true,
      image_index: 12,
      image_name: 'example.com',
      database_icon: REF,
    })
    expect(stored.kind).toBe('custom')
  })

  it.each([-1, 135, undefined])('an out-of-range number (%s) reads as the default', (index) => {
    expect(storedIconSelection({ image_custom: false, image_index: index })).toEqual({
      kind: 'default',
    })
  })
})

describe('effectiveIconSelection', () => {
  const stored = { kind: 'standard', index: 5 } as const

  it('shows the stored icon while nothing was changed', () => {
    expect(effectiveIconSelection(ICON_UNCHANGED, stored)).toBe(stored)
  })

  it.each<[IconChoice]>([[{ kind: 'default' }], [{ kind: 'standard', index: 9 }]])(
    'shows the choice %j once there is one',
    (choice) => {
      expect(effectiveIconSelection(choice, stored)).toEqual(choice)
    },
  )

  it('a chosen database icon is shown by its reference', () => {
    expect(effectiveIconSelection({ kind: 'custom', icon: REF }, stored)).toEqual({
      kind: 'custom',
      name: 'example.com',
      icon: REF,
    })
  })
})

describe('isSameIconName', () => {
  it('compares case-insensitively, like the server', () => {
    expect(isSameIconName('Example.COM', 'example.com')).toBe(true)
    expect(isSameIconName('example.com', 'example.com (2)')).toBe(false)
  })
})
