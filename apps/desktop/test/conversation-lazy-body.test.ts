import { describe, expect, it } from 'vitest'
import type { MessageDetail } from '@mailrovers/mail-contracts'
import {
  shouldLoadMessageBody,
  sortConversationMessagesNewestFirst,
} from '@/features/conversation/ConversationReader.js'

describe('conversation lazy body loading', () => {
  it('does not request bodies for collapsed older messages', () => {
    expect(shouldLoadMessageBody(false, true)).toBe(false)
  })

  it('requests an available body only after expansion', () => {
    expect(shouldLoadMessageBody(true, true)).toBe(true)
    expect(shouldLoadMessageBody(true, false)).toBe(false)
  })
})

describe('conversation message ordering', () => {
  function message(id: string, receivedAt: string): MessageDetail {
    return {
      id: id as MessageDetail['id'],
      conversationId: 'conversation-1' as MessageDetail['conversationId'],
      sender: { address: `${id}@example.test` },
      recipients: { to: [], cc: [], bcc: [] },
      subject: 'Subject',
      receivedAt: receivedAt as MessageDetail['receivedAt'],
      bodyAvailable: true,
      isDraft: false,
      labelIds: [],
      attachments: [],
    }
  }

  it('sorts messages with the newest receivedAt first', () => {
    const older = message('message-1', '2026-07-21T10:00:00.000Z')
    const newer = message('message-2', '2026-07-22T10:00:00.000Z')

    expect(sortConversationMessagesNewestFirst([older, newer])).toEqual([newer, older])
  })

  it('breaks ties by message id descending', () => {
    const first = message('message-a', '2026-07-22T10:00:00.000Z')
    const second = message('message-b', '2026-07-22T10:00:00.000Z')

    expect(sortConversationMessagesNewestFirst([first, second])).toEqual([second, first])
  })
})
