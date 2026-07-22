import { ISSUE_STATES, createMailApplication } from '@mailrovers/mail-application'
import type { CommandState } from '@mailrovers/mail-contracts'
import {
  commandId,
  conversationId,
  draftId,
  fingerprintDraftRevision,
  labelId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
  type CommandId,
  type Mailbox,
  type NormalizedDraft,
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
  it('rejects commands targeting another mailbox conversation, message, or label', async () => {
    const otherMailboxLabel = (await store.listLabels(otherMailbox.id))[0]
    if (otherMailboxLabel === undefined) throw new Error('Expected the other mailbox label')
    const outboxCount = countRows('command_outbox')

    await expect(
      store.enqueueCommand({
        id: commandId('foreign-command-conversation'),
        mailboxId: mailbox.id,
        idempotencyKey: 'foreign-command-conversation',
        command: {
          kind: 'set-thread-read',
          conversationId: otherMailboxConversation,
          read: true,
        },
        createdAt: timestamp,
      }),
    ).rejects.toThrow('COMMAND_TARGET_NOT_FOUND')
    await expect(
      store.enqueueCommand({
        id: commandId('foreign-command-message'),
        mailboxId: mailbox.id,
        idempotencyKey: 'foreign-command-message',
        command: {
          kind: 'set-message-starred',
          messageId: otherMailboxMessage,
          starred: true,
        },
        createdAt: timestamp,
      }),
    ).rejects.toThrow('COMMAND_TARGET_NOT_FOUND')
    await expect(
      store.enqueueCommand({
        id: commandId('foreign-command-label'),
        mailboxId: mailbox.id,
        idempotencyKey: 'foreign-command-label',
        command: {
          kind: 'set-thread-label',
          conversationId: mailboxConversation,
          labelId: otherMailboxLabel.id,
          applied: true,
        },
        createdAt: timestamp,
      }),
    ).rejects.toThrow('COMMAND_TARGET_NOT_FOUND')

    expect(countRows('command_outbox')).toBe(outboxCount)
  })

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
        conversationId: otherMailboxConversation,
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
        conversationId: mailboxConversation,
        archived: true,
      },
    })
    const secondCommand = await application.executeCommand({
      requestId: operationId('same-key-command-b'),
      mailboxId: otherMailbox.id,
      idempotencyKey: 'same-key-command',
      command: {
        kind: 'set-thread-read',
        conversationId: otherMailboxConversation,
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
          conversationId: mailboxConversation,
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
        conversationId: mailboxConversation,
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
        conversationId: otherMailboxConversation,
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

  it('rejects cross-mailbox batches and excludes foreign messages from conversation reads', async () => {
    const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
    const foreignMessage: NormalizedMessage = {
      ...normalizedMessage({
        mailbox: otherMailbox,
        conversation: otherMailboxConversation,
        id: messageId('gmail:ownership-other:message:rejected'),
      }),
      providerMessageId: 'foreign-rejected',
    }
    await expect(
      store.applyHistoryPage({
        mailboxId: mailbox.id,
        batch: {
          labels: [
            {
              id: labelId('gmail:ownership:label:must-rollback'),
              mailboxId: mailbox.id,
              providerLabelId: 'MUST_ROLLBACK',
              name: 'Must roll back',
              kind: 'user',
              updatedAt: timestamp,
            },
          ],
          messages: [foreignMessage],
        },
        nextPageToken: 'rejected-page',
        targetCursor: '101',
        updatedAt: timestamp,
        fence,
      }),
    ).rejects.toThrow('Provider change batch mailbox mismatch')
    expect(
      database.prepare('SELECT 1 FROM labels WHERE provider_label_id=?').get('MUST_ROLLBACK'),
    ).toBeUndefined()
    expect(
      database.prepare('SELECT 1 FROM messages WHERE id=?').get(foreignMessage.id),
    ).toBeUndefined()

    const foreignStoredId = messageId('gmail:ownership-other:message:stored')
    database
      .prepare(
        `INSERT INTO messages
      (id,workspace_id,mailbox_id,conversation_id,provider_message_id,internet_message_id,
      provider_history_id,sender_json,recipients_json,subject,sent_at,received_at,snippet,
      text_body,sanitized_html_body,size_bytes,is_draft,created_at,updated_at)
      SELECT ?,workspace_id,?,conversation_id,?,'<foreign-stored@example.test>',
      provider_history_id,?,recipients_json,'Foreign subject',sent_at,received_at,'Foreign snippet',
      text_body,sanitized_html_body,size_bytes,is_draft,created_at,updated_at
      FROM messages WHERE id=?`,
      )
      .run(
        foreignStoredId,
        otherMailbox.id,
        'foreign-stored',
        JSON.stringify({ name: 'Mallory', address: 'mallory@example.test' }),
        mailboxMessage,
      )
    database
      .prepare(
        `INSERT INTO message_labels(message_id,label_id)
      SELECT ?,id FROM labels WHERE mailbox_id=? AND provider_label_id='INBOX'`,
      )
      .run(foreignStoredId, mailbox.id)
    database
      .prepare(
        `INSERT INTO attachments
      (id,message_id,provider_attachment_id,filename,media_type,size_bytes,content_id,disposition,
      local_path,download_state)
      VALUES ('gmail:ownership-other:attachment:stored',?,'foreign-attachment','foreign.txt',
      'text/plain',12,NULL,'attachment',NULL,'remote')`,
      )
      .run(foreignStoredId)

    const localMessage = normalizedMessage({
      mailbox,
      conversation: mailboxConversation,
      id: mailboxMessage,
    })
    await store.applyHistoryPage({
      mailboxId: mailbox.id,
      batch: { messages: [{ ...localMessage, snippet: 'Updated local snippet' }] },
      nextPageToken: 'accepted-page',
      targetCursor: '101',
      updatedAt: timestamp,
      fence,
    })
    await store.releaseSyncLease({ mailboxId: mailbox.id, ...fence })

    const detail = await store.getConversation({
      requestId: operationId('mailbox-isolated-detail'),
      mailboxId: mailbox.id,
      conversationId: mailboxConversation,
    })
    expect(detail?.messages.map((entry) => entry.id)).toEqual([mailboxMessage])
    const page = await store.listConversations({ mailboxId: mailbox.id })
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        messageCount: 1,
        unreadCount: 0,
        senders: [{ address: 'sender@example.test' }],
      }),
    )
  })

  it('mailbox-scopes historical draft references when fingerprinting a conflict', async () => {
    const local = await store.saveDraft({
      request: {
        requestId: operationId('save-conflict-local'),
        mailboxId: mailbox.id,
        idempotencyKey: 'save-conflict-local',
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Local subject',
        textBody: 'Local body',
      },
      id: draftId('local-conflict'),
      internetMessageId: '<local-conflict@mailrovers.local>',
      updatedAt: timestamp,
    })
    database
      .prepare(
        `UPDATE drafts SET provider_draft_id='remote-draft',provider_message_id='remote-message',
        conversation_id=?,reply_to_message_id=? WHERE id=?`,
      )
      .run(otherMailboxConversation, otherMailboxMessage, local.id)
    const remote: NormalizedDraft = {
      id: draftId('remote-normalized'),
      workspaceId: mailbox.workspaceId,
      mailboxId: mailbox.id,
      providerDraftId: 'remote-draft',
      providerMessageId: 'remote-message-new',
      providerThreadId: 'remote-thread',
      internetMessageId: '<remote@mailrovers.local>',
      sender: { address: mailbox.emailAddress, name: mailbox.displayName },
      references: [],
      providerFingerprint: fingerprintDraftRevision({
        internetMessageId: '<remote@mailrovers.local>',
        sender: { address: mailbox.emailAddress, name: mailbox.displayName },
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Remote subject',
        textBody: 'Remote body',
        providerThreadId: 'remote-thread',
        references: [],
      }),
      to: [{ address: 'ada@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Remote subject',
      textBody: 'Remote body',
      updatedAt: timestamp,
    }
    const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
    await store.beginDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      fence,
    })
    await store.stageDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      drafts: [remote],
      fence,
    })
    await store.completeDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      completedAt: timestamp,
      fence,
    })
    const drafts = await store.listDrafts(mailbox.id)
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          syncState: 'conflict',
          textBody: 'Local body',
        }),
        expect.objectContaining({
          id: local.id,
          syncState: 'synced',
          textBody: 'Remote body',
        }),
      ]),
    )
    const conflict = database
      .prepare(
        `SELECT internet_message_id,revision_fingerprint,conversation_id,reply_to_message_id
        FROM drafts
        WHERE conflict_of_draft_id=?`,
      )
      .get(local.id) as {
      internet_message_id: string
      revision_fingerprint: string
      conversation_id: string
      reply_to_message_id: string
    }
    expect(conflict.conversation_id).toBe(otherMailboxConversation)
    expect(conflict.reply_to_message_id).toBe(otherMailboxMessage)
    expect(conflict.revision_fingerprint).toBe(
      fingerprintDraftRevision({
        internetMessageId: conflict.internet_message_id,
        sender: { address: mailbox.emailAddress, name: mailbox.displayName },
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Local subject',
        textBody: 'Local body',
        references: [],
      }),
    )
  })
})
