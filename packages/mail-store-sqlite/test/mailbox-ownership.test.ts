import { ISSUE_STATES, createMailApplication } from '@mailrovers/mail-application'
import type { CommandState } from '@mailrovers/mail-contracts'
import {
  commandId,
  conversationId,
  draftId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
  type CommandId,
  type Mailbox,
  type NormalizedMessage,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'
import { acquireTestSyncFence } from './sync-fence.js'

type CommandStateFixture = {
  id: CommandId
  state: CommandState
}

const timestamp = utcTimestamp('2026-07-13T12:00:00.000Z')
const workspace = workspaceId('workspace-ownership')
const mailbox: Mailbox = {
  id: mailboxId('gmail:ownership'),
  workspaceId: workspace,
  provider: 'gmail',
  providerAccountId: 'ownership',
  emailAddress: 'owner@example.test',
  displayName: 'Owner',
  syncState: 'ready',
  createdAt: timestamp,
  updatedAt: timestamp,
}
const otherMailbox: Mailbox = {
  id: mailboxId('gmail:ownership-other'),
  workspaceId: workspace,
  provider: 'gmail',
  providerAccountId: 'ownership-other',
  emailAddress: 'other@example.test',
  displayName: 'Other',
  syncState: 'ready',
  createdAt: timestamp,
  updatedAt: timestamp,
}
function normalizedMessage(input: {
  mailbox: Mailbox
  conversation: ReturnType<typeof conversationId>
  id: ReturnType<typeof messageId>
}): NormalizedMessage {
  return {
    id: input.id,
    workspaceId: input.mailbox.workspaceId,
    mailboxId: input.mailbox.id,
    conversationId: input.conversation,
    providerThreadId: `thread-${input.conversation}`,
    providerMessageId: `message-${input.id}`,
    sender: { address: 'sender@example.test' },
    recipients: { to: [{ address: input.mailbox.emailAddress }], cc: [], bcc: [] },
    subject: 'Thread subject',
    receivedAt: timestamp,
    snippet: 'Thread snippet',
    textBody: 'Thread body',
    sizeBytes: 100,
    isDraft: false,
    providerLabelIds: ['INBOX'],
    attachments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

const mailboxConversation = conversationId('gmail:ownership:conversation')
const mailboxMessage = messageId('gmail:ownership:message')
const otherMailboxConversation = conversationId('gmail:ownership-other:conversation')
const otherMailboxMessage = messageId('gmail:ownership-other:message')

function isCountRow(value: unknown): value is { count: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'count' in value &&
    typeof value.count === 'number'
  )
}

function countRows(table: 'drafts' | 'command_outbox'): number {
  const value = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
  if (!isCountRow(value)) throw new Error(`Could not count ${table}`)
  return value.count
}

const nonIssueStates = [
  'pending',
  'running',
  'succeeded',
  'cancelled',
  'retry_wait',
] as const satisfies readonly CommandState[]

let database: ReturnType<typeof openDatabase>
let store: SqliteMailStore

beforeEach(async () => {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-ownership-')), 'mail.sqlite'))
  migrate(database)
  store = new SqliteMailStore(database)
  for (const connectedMailbox of [mailbox, otherMailbox]) {
    const checkpoint: SyncCheckpoint = {
      mailboxId: connectedMailbox.id,
      providerCursor: '100',
      importState: 'complete',
      importedMessageCount: 0,
      importedDraftCount: 0,
      updatedAt: timestamp,
    }
    await store.saveConnectedMailbox({
      mailbox: connectedMailbox,
      checkpoint,
      encryptedRefreshToken: new Uint8Array([1]),
    })
  }
  for (const [connectedMailbox, conversation, id] of [
    [mailbox, mailboxConversation, mailboxMessage],
    [otherMailbox, otherMailboxConversation, otherMailboxMessage],
  ] as const) {
    const fence = await acquireTestSyncFence(store, connectedMailbox.id, timestamp)
    await store.applyImportBatch({
      mailboxId: connectedMailbox.id,
      batch: { messages: [normalizedMessage({ mailbox: connectedMailbox, conversation, id })] },
      updatedAt: timestamp,
      fence,
    })
    await store.releaseSyncLease({ mailboxId: connectedMailbox.id, ...fence })
  }
})

afterEach(() => database.close())

describe('SQLite mailbox ownership', () => {
  it('isolates drafts by mailbox even when a foreign draft ID is supplied', async () => {
    const owned = await store.saveDraft({
      request: {
        requestId: operationId('owned-draft'),
        mailboxId: mailbox.id,
        idempotencyKey: 'owned-draft',
        to: [],
        cc: [],
        bcc: [],
        subject: 'Owned',
        textBody: 'Owned body',
      },
      id: draftId('owned-draft'),
      internetMessageId: '<owned-draft@mailrovers.local>',
      updatedAt: timestamp,
    })

    const replayed = await store.saveDraft({
      request: {
        requestId: operationId('owned-draft-retry'),
        mailboxId: mailbox.id,
        idempotencyKey: 'owned-draft',
        to: [],
        cc: [],
        bcc: [],
        subject: 'Ignored replay',
        textBody: 'Ignored replay',
      },
      id: draftId('owned-draft-retry'),
      internetMessageId: '<owned-draft-retry@mailrovers.local>',
      updatedAt: timestamp,
    })
    expect(replayed).toEqual(expect.objectContaining({ id: owned.id, subject: 'Owned' }))

    await expect(
      store.saveDraft({
        request: {
          requestId: operationId('foreign-draft-save'),
          mailboxId: otherMailbox.id,
          draftId: owned.id,
          idempotencyKey: 'foreign-draft-save',
          to: [],
          cc: [],
          bcc: [],
          subject: 'Foreign',
          textBody: 'Foreign body',
        },
        id: owned.id,
        internetMessageId: '<foreign-draft@mailrovers.local>',
        updatedAt: timestamp,
      }),
    ).rejects.toThrow('DRAFT_OWNERSHIP')
    await expect(
      store.getDraft({ mailboxId: otherMailbox.id, draftId: owned.id }),
    ).resolves.toBeUndefined()
    await expect(store.listDrafts(otherMailbox.id)).resolves.toEqual([])
    await expect(
      store.enqueueSendDraft({
        mailboxId: otherMailbox.id,
        draftId: owned.id,
        expectedVersion: owned.version,
        idempotencyKey: 'foreign-draft-send',
        createdAt: timestamp,
      }),
    ).rejects.toThrow('DRAFT_VERSION_CONFLICT')
    await expect(store.getDraft({ mailboxId: mailbox.id, draftId: owned.id })).resolves.toEqual(
      expect.objectContaining({ subject: 'Owned', textBody: 'Owned body' }),
    )
    await store.enqueueCommand({
      id: commandId('draft-operation-collision'),
      mailboxId: otherMailbox.id,
      idempotencyKey: 'draft-operation-collision',
      command: {
        kind: 'set-thread-read',
        conversationId: conversationId('other-thread'),
        read: true,
      },
      createdAt: timestamp,
    })
    await expect(
      store.saveDraft({
        request: {
          requestId: operationId('draft-operation-collision'),
          mailboxId: otherMailbox.id,
          idempotencyKey: 'draft-operation-collision',
          to: [],
          cc: [],
          bcc: [],
          subject: 'Collision',
          textBody: 'Collision',
        },
        id: draftId('draft-operation-collision'),
        internetMessageId: '<draft-operation-collision@mailrovers.local>',
        updatedAt: timestamp,
      }),
    ).rejects.toThrow('IDEMPOTENCY_KEY_OPERATION_MISMATCH')
  })

  it('rejects foreign draft references atomically while keeping same-mailbox references', async () => {
    const valid = await store.saveDraft({
      request: {
        requestId: operationId('same-mailbox-references'),
        mailboxId: mailbox.id,
        conversationId: mailboxConversation,
        replyToMessageId: mailboxMessage,
        idempotencyKey: 'same-mailbox-references',
        to: [],
        cc: [],
        bcc: [],
        subject: 'Valid references',
        textBody: 'Valid references',
      },
      id: draftId('same-mailbox-references'),
      internetMessageId: '<same-mailbox-references@mailrovers.local>',
      updatedAt: timestamp,
    })
    expect(valid).toEqual(
      expect.objectContaining({
        conversationId: mailboxConversation,
        replyToMessageId: mailboxMessage,
      }),
    )

    const draftCount = countRows('drafts')
    const outboxCount = countRows('command_outbox')
    await expect(
      store.saveDraft({
        request: {
          requestId: operationId('foreign-conversation-reference'),
          mailboxId: mailbox.id,
          conversationId: otherMailboxConversation,
          idempotencyKey: 'foreign-conversation-reference',
          to: [],
          cc: [],
          bcc: [],
          subject: 'Foreign conversation',
          textBody: 'Foreign conversation',
        },
        id: draftId('foreign-conversation-reference'),
        internetMessageId: '<foreign-conversation-reference@mailrovers.local>',
        updatedAt: timestamp,
      }),
    ).rejects.toThrow('DRAFT_CONVERSATION_NOT_FOUND')
    await expect(
      store.saveDraft({
        request: {
          requestId: operationId('foreign-reply-reference'),
          mailboxId: mailbox.id,
          replyToMessageId: otherMailboxMessage,
          idempotencyKey: 'foreign-reply-reference',
          to: [],
          cc: [],
          bcc: [],
          subject: 'Foreign reply',
          textBody: 'Foreign reply',
        },
        id: draftId('foreign-reply-reference'),
        internetMessageId: '<foreign-reply-reference@mailrovers.local>',
        updatedAt: timestamp,
      }),
    ).rejects.toThrow('DRAFT_REPLY_TO_MESSAGE_NOT_FOUND')

    expect(countRows('drafts')).toBe(draftCount)
    expect(countRows('command_outbox')).toBe(outboxCount)
    await expect(store.getDraft({ mailboxId: mailbox.id, draftId: valid.id })).resolves.toEqual(
      expect.objectContaining({
        subject: 'Valid references',
        conversationId: mailboxConversation,
        replyToMessageId: mailboxMessage,
      }),
    )
  })

  it('keeps same-key draft and command replays independent across mailboxes', async () => {
    const application = createMailApplication(store)
    const first = await application.saveDraft({
      requestId: operationId('same-key-draft-a'),
      mailboxId: mailbox.id,
      idempotencyKey: 'same-key-draft',
      to: [],
      cc: [],
      bcc: [],
      subject: 'A',
      textBody: 'A',
    })
    const second = await application.saveDraft({
      requestId: operationId('same-key-draft-b'),
      mailboxId: otherMailbox.id,
      idempotencyKey: 'same-key-draft',
      to: [],
      cc: [],
      bcc: [],
      subject: 'B',
      textBody: 'B',
    })
    const firstReplay = await application.saveDraft({
      requestId: operationId('same-key-draft-a-replay'),
      mailboxId: mailbox.id,
      idempotencyKey: 'same-key-draft',
      to: [],
      cc: [],
      bcc: [],
      subject: 'Ignored replay',
      textBody: 'Ignored replay',
    })
    const firstSend = await application.sendDraft({
      requestId: operationId('same-key-send-a'),
      mailboxId: mailbox.id,
      draftId: first.id,
      expectedVersion: first.version,
      idempotencyKey: 'same-key-send',
    })
    const secondSend = await application.sendDraft({
      requestId: operationId('same-key-send-b'),
      mailboxId: otherMailbox.id,
      draftId: second.id,
      expectedVersion: second.version,
      idempotencyKey: 'same-key-send',
    })
    const firstCommand = await application.executeCommand({
      requestId: operationId('same-key-command-a'),
      mailboxId: mailbox.id,
      idempotencyKey: 'same-key-command',
      command: {
        kind: 'set-thread-archived',
        conversationId: conversationId('first-thread'),
        archived: true,
      },
    })
    const secondCommand = await application.executeCommand({
      requestId: operationId('same-key-command-b'),
      mailboxId: otherMailbox.id,
      idempotencyKey: 'same-key-command',
      command: {
        kind: 'set-thread-read',
        conversationId: conversationId('other-thread'),
        read: true,
      },
    })

    expect(first.id).not.toBe(second.id)
    expect(firstReplay).toEqual(expect.objectContaining({ id: first.id, subject: 'A' }))
    expect(firstSend.commandId).not.toBe(secondSend.commandId)
    expect(firstCommand.id).not.toBe(secondCommand.id)
    expect(await store.listDrafts(mailbox.id)).toEqual([expect.objectContaining({ id: first.id })])
    expect(await store.listDrafts(otherMailbox.id)).toEqual([
      expect.objectContaining({ id: second.id }),
    ])
  })

  it('requires mailbox-local issue states for user command resolutions', async () => {
    const nonIssueCommands: CommandStateFixture[] = []
    for (const state of nonIssueStates) {
      const command = await store.enqueueCommand({
        id: commandId(`non-issue-${state}`),
        mailboxId: mailbox.id,
        idempotencyKey: `non-issue-${state}`,
        command: {
          kind: 'set-thread-read',
          conversationId: conversationId(`non-issue-${state}`),
          read: true,
        },
        createdAt: timestamp,
      })
      await store.setCommandState({
        id: command.id,
        mailboxId: mailbox.id,
        state,
        updatedAt: timestamp,
      })
      nonIssueCommands.push({ id: command.id, state })
    }
    const failed = await store.enqueueCommand({
      id: commandId('issue-failed'),
      mailboxId: mailbox.id,
      idempotencyKey: 'issue-failed',
      command: {
        kind: 'set-thread-archived',
        conversationId: conversationId('issue-failed'),
        archived: true,
      },
      createdAt: timestamp,
    })
    const needsReview = await store.enqueueCommand({
      id: commandId('issue-needs-review'),
      mailboxId: otherMailbox.id,
      idempotencyKey: 'issue-needs-review',
      command: {
        kind: 'set-thread-read',
        conversationId: conversationId('issue-needs-review'),
        read: true,
      },
      createdAt: timestamp,
    })
    await store.setCommandState({
      id: failed.id,
      mailboxId: mailbox.id,
      state: 'failed',
      updatedAt: timestamp,
    })
    await store.setCommandState({
      id: needsReview.id,
      mailboxId: otherMailbox.id,
      state: 'needs_review',
      updatedAt: timestamp,
    })

    const committed: unknown[] = []
    const unsubscribe = store.subscribeCommittedChanges((changes) => committed.push(changes))
    await expect(
      store.setCommandState({
        id: failed.id,
        mailboxId: otherMailbox.id,
        state: 'pending',
        updatedAt: timestamp,
        allowedSourceStates: ISSUE_STATES,
      }),
    ).rejects.toThrow('COMMAND_STATE_TRANSITION_NOT_FOUND')
    for (const command of nonIssueCommands) {
      await expect(
        store.setCommandState({
          id: command.id,
          mailboxId: mailbox.id,
          state: 'pending',
          updatedAt: timestamp,
          allowedSourceStates: ISSUE_STATES,
        }),
      ).rejects.toThrow('COMMAND_STATE_TRANSITION_NOT_FOUND')
      expect(
        database.prepare('SELECT state FROM command_outbox WHERE id=?').get(command.id),
      ).toEqual({
        state: command.state,
      })
    }
    expect(committed).toEqual([])

    await store.setCommandState({
      id: failed.id,
      mailboxId: mailbox.id,
      state: 'pending',
      updatedAt: timestamp,
      allowedSourceStates: ISSUE_STATES,
    })
    await store.setCommandState({
      id: needsReview.id,
      mailboxId: otherMailbox.id,
      state: 'cancelled',
      updatedAt: timestamp,
      allowedSourceStates: ISSUE_STATES,
    })
    unsubscribe()

    expect(committed).toEqual([
      { mailboxId: mailbox.id, outbox: true },
      { mailboxId: otherMailbox.id, outbox: true },
    ])
    expect(await store.listCommandIssues(mailbox.id)).toEqual([])
    expect(await store.listCommandIssues(otherMailbox.id)).toEqual([])
  })
})
