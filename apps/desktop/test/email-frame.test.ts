import { describe, expect, it } from 'vitest'
import { measureEmailFrameHeight } from '@/features/conversation/EmailFrame.js'

describe('measureEmailFrameHeight', () => {
  it('returns 0 when the iframe document is unavailable', () => {
    const iframe = {
      contentDocument: null,
    } as HTMLIFrameElement

    expect(measureEmailFrameHeight(iframe)).toBe(0)
  })

  it('uses the tallest document metric', () => {
    const iframe = {
      contentDocument: {
        documentElement: { scrollHeight: 240, offsetHeight: 200 },
        body: { scrollHeight: 280, offsetHeight: 220 },
      },
    } as HTMLIFrameElement

    expect(measureEmailFrameHeight(iframe)).toBe(280)
  })
})
