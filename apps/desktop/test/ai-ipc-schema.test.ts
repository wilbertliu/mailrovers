import { describe, expect, it } from 'vitest'
import {
  aiConfigurationStatusSchema,
  aiStreamEventSchema,
  draftReplyInputSchema,
  saveAiConfigurationInputSchema,
  summarizeConversationInputSchema,
} from '../electron/ipc/ai.schema.js'

const base = { requestId: 'request-one', mailboxId: 'gmail:account' }

describe('AI IPC schemas', () => {
  it('accepts task-shaped AI inputs and bounds instructions', () => {
    expect(
      summarizeConversationInputSchema.parse({
        ...base,
        conversationId: 'conversation-one',
        sourceVersion: 2,
      }),
    ).toEqual({ ...base, conversationId: 'conversation-one', sourceVersion: 2 })
    expect(
      draftReplyInputSchema.safeParse({
        ...base,
        conversationId: 'conversation-one',
        sourceVersion: 2,
        draftId: 'draft-one',
        draftVersion: 3,
        userInstructions: 'x'.repeat(10_001),
      }).success,
    ).toBe(false)
  })

  it('allows one-way API key submission but never key readback', () => {
    expect(
      saveAiConfigurationInputSchema.parse({
        ...base,
        baseUrl: 'https://api.example.test/v1',
        model: 'test-model',
        apiKey: 'secret',
      }),
    ).toEqual({
      ...base,
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      apiKey: 'secret',
    })
    expect(
      aiConfigurationStatusSchema.safeParse({
        mailboxId: base.mailboxId,
        state: 'configured',
        hasApiKey: true,
        apiKey: 'must-not-cross-ipc',
      }).success,
    ).toBe(false)
  })

  it('validates ordered stream event shapes and bounded artifacts', () => {
    expect(
      aiStreamEventSchema.parse({
        kind: 'ai-delta',
        requestId: 'request-one',
        mailboxId: 'gmail:account',
        text: 'partial',
      }),
    ).toEqual({
      kind: 'ai-delta',
      requestId: 'request-one',
      mailboxId: 'gmail:account',
      text: 'partial',
    })
    expect(
      aiStreamEventSchema.safeParse({
        kind: 'ai-completed',
        requestId: 'request-one',
        mailboxId: 'gmail:account',
        artifact: { content: 'missing audit metadata' },
      }).success,
    ).toBe(false)
  })
})
