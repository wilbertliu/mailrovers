import { describe, expect, it } from 'vitest'
import { splitUtf8 } from '../electron/ipc/event-batching.js'

const encoder = new TextEncoder()

describe('preload event batching', () => {
  it('splits oversized text deltas on UTF-8 character boundaries', () => {
    const value = `${'a'.repeat(8_190)}🙂${'b'.repeat(8_200)}`
    const parts = splitUtf8(value, 8 * 1024)
    expect(parts.join('')).toBe(value)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((part) => encoder.encode(part).byteLength <= 8 * 1024)).toBe(true)
  })
})
