import { describe, it, expect } from 'vitest'
import { formatBytes } from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [32768, '32 KB'],
    [10 * 1024 * 1024, '10 MB'],
    [64 * 1024 * 1024, '64 MB'],
  ])('%i -> %j', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
