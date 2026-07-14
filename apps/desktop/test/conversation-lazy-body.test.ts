import { describe, expect, it } from 'vitest'
import { shouldLoadMessageBody } from '../src/features/conversation/ConversationReader.js'

describe('conversation lazy body loading', () => {
  it('does not request bodies for collapsed older messages', () => {
    expect(shouldLoadMessageBody(false, true)).toBe(false)
  })

  it('requests an available body only after expansion', () => {
    expect(shouldLoadMessageBody(true, true)).toBe(true)
    expect(shouldLoadMessageBody(true, false)).toBe(false)
  })
})
