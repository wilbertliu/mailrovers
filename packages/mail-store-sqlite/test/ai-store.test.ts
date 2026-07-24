import {
  aiArtifactId,
  conversationId,
  draftId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
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

const timestamp = utcTimestamp('2026-07-13T12:00:00.000Z')
const mailbox: Mailbox = {
  id: mailboxId('gmail:ai'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'ai',
  emailAddress: 'owner@example.test',
  displayName: 'Owner',
  syncState: 'ready',
  createdAt: timestamp,
  updatedAt: timestamp,
}
const checkpoint: SyncCheckpoint = {
  mailboxId: mailbox.id,
  providerCursor: '100',
  importState: 'complete',
  importedMessageCount: 1,
  importedDraftCount: 0,
  updatedAt: timestamp,
}
const conversation = conversationId('gmail:ai:conversation:one')

function normalizedMessage(): NormalizedMessage {
  return {
    id: messageId('gmail:ai:message:one'),
    workspaceId: mailbox.workspaceId,
    mailboxId: mailbox.id,
    conversationId: conversation,
    providerThreadId: 'thread-one',
    providerMessageId: 'message-one',
    sender: { address: 'sender@example.test' },
    recipients: { to: [{ address: mailbox.emailAddress }], cc: [], bcc: [] },
    subject: 'AI test subject',
    receivedAt: timestamp,
    snippet: 'AI context',
    textBody: 'Selected conversation text.',
    sizeBytes: 30,
    isDraft: false,
    providerLabelIds: ['INBOX'],
    attachments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

let database: ReturnType<typeof openDatabase>
let store: SqliteMailStore

beforeEach(async () => {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-ai-')), 'mail.sqlite'))
  migrate(database)
  store = new SqliteMailStore(database)
  await store.saveConnectedMailbox({
    mailbox,
    checkpoint,
    encryptedRefreshToken: new Uint8Array([1, 2, 3]),
  })
  const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
  await store.applyImportBatch({
    mailboxId: mailbox.id,
    batch: { messages: [normalizedMessage()] },
    updatedAt: timestamp,
    fence,
  })
})

afterEach(() => database.close())

describe('SQLite AI store', () => {
  it('stores public AI settings separately from encrypted key bytes', async () => {
    await store.saveAiConfiguration({
      mailboxId: mailbox.id,
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      encryptedApiKey: new Uint8Array([9, 8, 7]),
      updatedAt: timestamp,
    })
    expect(await store.getAiConfiguration(mailbox.id)).toEqual({
      mailboxId: mailbox.id,
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      encryptedApiKey: new Uint8Array([9, 8, 7]),
    })
    const setting = database
      .prepare('SELECT value_json FROM app_settings WHERE key=?')
      .get(`ai.configuration.${mailbox.id}`) as { value_json: string }
    expect(setting.value_json).not.toContain('9,8,7')
  })

  it('preserves AI configuration when Gmail disconnects but local data remains', async () => {
    await store.saveAiConfiguration({
      mailboxId: mailbox.id,
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
      encryptedApiKey: new Uint8Array([9]),
      updatedAt: timestamp,
    })
    await store.removeMailbox({ mailboxId: mailbox.id, removeLocalData: false })
    expect(await store.getEncryptedRefreshToken(mailbox.id)).toBeUndefined()
    expect((await store.getAiConfiguration(mailbox.id))?.encryptedApiKey).toEqual(
      new Uint8Array([9]),
    )
  })

  it('matches summary cache entries by source version, model, and policy', async () => {
    const artifact = {
      id: aiArtifactId('artifact-one'),
      mailboxId: mailbox.id,
      conversationId: conversation,
      artifactType: 'conversation_summary' as const,
      sourceVersion: 1,
      model: 'model-one',
      policyVersion: 'summary-v1',
      content: 'A local summary.',
      createdAt: timestamp,
    }
    await store.saveAiArtifact(artifact)
    await expect(
      store.findAiArtifact({
        mailboxId: mailbox.id,
        conversationId: conversation,
        artifactType: 'conversation_summary',
        sourceVersion: 1,
        model: 'model-one',
        policyVersion: 'summary-v1',
      }),
    ).resolves.toEqual(artifact)
    await expect(
      store.findAiArtifact({
        mailboxId: mailbox.id,
        conversationId: conversation,
        artifactType: 'conversation_summary',
        sourceVersion: 1,
        model: 'model-two',
        policyVersion: 'summary-v1',
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects review when a reply suggestion draft version is stale', async () => {
    const draft = await store.saveDraft({
      request: {
        requestId: operationId('save-draft'),
        mailboxId: mailbox.id,
        conversationId: conversation,
        idempotencyKey: 'save-draft',
        to: [{ address: 'sender@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Re: AI test subject',
        textBody: '',
      },
      id: draftId('draft-one'),
      internetMessageId: '<draft-one@mailrovers.local>',
      updatedAt: timestamp,
    })
    await store.saveAiArtifact({
      id: aiArtifactId('reply-one'),
      mailboxId: mailbox.id,
      conversationId: conversation,
      artifactType: 'reply_draft',
      sourceVersion: 1,
      model: 'model-one',
      policyVersion: 'reply-v1',
      content: 'Suggested reply.',
      draftId: draft.id,
      draftVersion: draft.version,
      recipientFingerprint: 'recipient-one',
      createdAt: timestamp,
    })
    await store.saveDraft({
      request: {
        requestId: operationId('update-draft'),
        mailboxId: mailbox.id,
        draftId: draft.id,
        conversationId: conversation,
        expectedVersion: draft.version,
        idempotencyKey: 'update-draft',
        to: [{ address: 'sender@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Re: AI test subject',
        textBody: 'Changed locally.',
      },
      id: draft.id,
      internetMessageId: '<draft-one@mailrovers.local>',
      updatedAt: timestamp,
    })
    await expect(
      store.reviewAiArtifact({
        mailboxId: mailbox.id,
        artifactId: aiArtifactId('reply-one'),
        decision: 'accepted',
        reviewedAt: timestamp,
        expectedDraftVersion: draft.version,
      }),
    ).rejects.toThrow('AI_ARTIFACT_STALE')
  })
})
