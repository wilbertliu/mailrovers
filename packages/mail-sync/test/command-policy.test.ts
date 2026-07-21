import type { DurableCommand } from '@mailrovers/mail-contracts'
import {
  commandId,
  conversationId,
  draftId,
  labelId,
  mailboxId,
  messageId,
  draftRevisionFingerprint,
  utcTimestamp,
} from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import { commandCompletionFor, needsReviewTransitionFor, policyFor } from '../src/command-policy.js'

const mailbox = mailboxId('gmail:policy')
const now = utcTimestamp('2026-07-13T00:00:00.000Z')
const draftExpectation = {
  draftId: draftId('draft'),
  expectedVersion: 3,
  outboundRevisionFingerprint: draftRevisionFingerprint('0'.repeat(64)),
}

const archivedCommand: DurableCommand = {
  kind: 'set-thread-archived',
  conversationId: conversationId('conversation'),
  archived: true,
}
const syncDraftCommand: DurableCommand = { kind: 'sync-draft', ...draftExpectation }

const commands: Array<{
  name: string
  command: DurableCommand
  policy: 'retry-safe' | 'reconcile-before-retry'
}> = [
  {
    name: 'set-thread-archived',
    command: archivedCommand,
    policy: 'retry-safe',
  },
  {
    name: 'set-thread-read',
    command: {
      kind: 'set-thread-read',
      conversationId: conversationId('conversation'),
      read: true,
    },
    policy: 'retry-safe',
  },
  {
    name: 'set-message-starred',
    command: { kind: 'set-message-starred', messageId: messageId('message'), starred: true },
    policy: 'retry-safe',
  },
  {
    name: 'set-thread-label',
    command: {
      kind: 'set-thread-label',
      conversationId: conversationId('conversation'),
      labelId: labelId('label'),
      applied: true,
    },
    policy: 'retry-safe',
  },
  {
    name: 'sync-draft',
    command: syncDraftCommand,
    policy: 'reconcile-before-retry',
  },
  {
    name: 'send-draft',
    command: { kind: 'send-draft', ...draftExpectation },
    policy: 'reconcile-before-retry',
  },
]

describe('command policy', () => {
  it.each(commands)('$name has the canonical retry policy', ({ command, policy }) => {
    expect(policyFor(command)).toEqual({ kind: policy })
  })

  it('builds mailbox-scoped completion and review transitions', () => {
    const command = syncDraftCommand
    expect(
      commandCompletionFor({
        command,
        commandId: commandId('command'),
        mailboxId: mailbox,
        result: {
          changes: {},
          sentDraftId: draftExpectation.draftId,
        },
        completedAt: now,
      }),
    ).toEqual({
      id: commandId('command'),
      mailboxId: mailbox,
      changes: {},
      expectedDraftVersion: 3,
      expectedRevisionFingerprint: draftExpectation.outboundRevisionFingerprint,
      sentDraftId: draftExpectation.draftId,
      completedAt: now,
    })
    expect(
      needsReviewTransitionFor({
        commandId: commandId('command'),
        mailboxId: mailbox,
        updatedAt: now,
      }),
    ).toEqual({
      id: commandId('command'),
      mailboxId: mailbox,
      state: 'needs_review',
      errorCode: 'AMBIGUOUS_PROVIDER_RESULT',
      errorMessage: 'Gmail may have accepted this action. Review it before retrying.',
      updatedAt: now,
    })
  })

  it('omits draft-only completion fields for set-like commands', () => {
    expect(
      commandCompletionFor({
        command: archivedCommand,
        commandId: commandId('command'),
        mailboxId: mailbox,
        result: { changes: {} },
        completedAt: now,
      }),
    ).toEqual({
      id: commandId('command'),
      mailboxId: mailbox,
      changes: {},
      completedAt: now,
    })
  })
})
