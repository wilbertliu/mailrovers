import { describe, expect, it } from 'vitest'
import { listConversationsInputSchema } from '../../../apps/desktop/electron/ipc/list-conversations.schema.js'
describe('desktop query boundary', () => {
  it('rejects limits outside 1 to 200', () => {
    expect(() => listConversationsInputSchema.parse({ mailboxId: 'm', limit: 0 })).toThrow(
      'Number must be greater than or equal to 1',
    )
    expect(() => listConversationsInputSchema.parse({ mailboxId: 'm', limit: 201 })).toThrow(
      'Number must be less than or equal to 200',
    )
    expect(listConversationsInputSchema.parse({ mailboxId: 'm' }).limit).toBe(50)
  })
})
