import type { MailStore } from '@mailrovers/mail-application'
import {
  aiArtifactId,
  attachmentId,
  commandId,
  conversationId,
  draftId,
  draftRevisionFingerprint,
  labelId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
} from '@mailrovers/mail-domain'
import type {
  DatabaseMethod,
  DatabaseMethodInput,
  DatabaseMethodResult,
} from '../../electron/database/database-rpc.js'

const timestamp = utcTimestamp('2026-07-21T00:00:00.000Z')
const fingerprint = draftRevisionFingerprint('a'.repeat(64))
const mailbox = mailboxId('mailbox-1')
const workspace = workspaceId('workspace-1')
const conversation = conversationId('conversation-1')
const message = messageId('message-1')
const label = labelId('label-1')
const draft = draftId('draft-1')
const attachment = attachmentId('attachment-1')
const command = commandId('command-1')
const artifact = aiArtifactId('artifact-1')
const request = operationId('request-1')
const address = { address: 'maya@example.com' }
const capabilities = {
  threadArchive: true,
  threadRead: true,
  threadLabels: true,
  messageStar: true,
  drafts: true,
  send: true,
  search: true,
  attachmentExport: true,
}
const mailboxRecord = {
  id: mailbox,
  workspaceId: workspace,
  provider: 'gmail' as const,
  providerAccountId: 'account-1',
  emailAddress: 'alex@example.com',
  displayName: 'Alex',
  connectionState: 'connected' as const,
  syncState: 'ready' as const,
  createdAt: timestamp,
  updatedAt: timestamp,
}
const mailboxSummary = {
  id: mailbox,
  provider: 'gmail' as const,
  emailAddress: 'alex@example.com',
  displayName: 'Alex',
  syncState: 'ready' as const,
  connectionState: 'connected' as const,
  capabilities,
  importedMessageCount: 1,
}
const checkpoint = {
  mailboxId: mailbox,
  importState: 'complete' as const,
  importedMessageCount: 1,
  importedDraftCount: 0,
  updatedAt: timestamp,
}
const conversationPage = {
  items: [
    {
      id: conversation,
      mailboxId: mailbox,
      subject: 'Hello',
      snippet: 'Hello',
      senders: [address],
      lastMessageAt: timestamp,
      messageCount: 1,
      unreadCount: 0,
      hasAttachments: false,
      version: 1,
    },
  ],
}
const labelSummary = {
  id: label,
  mailboxId: mailbox,
  providerLabelId: 'INBOX',
  name: 'Inbox',
  kind: 'system' as const,
  conversationCount: 1,
  unreadCount: 0,
}
const conversationDetail = {
  id: conversation,
  mailboxId: mailbox,
  subject: 'Hello',
  version: 1,
  messages: [
    {
      id: message,
      conversationId: conversation,
      sender: address,
      recipients: { to: [address], cc: [], bcc: [] },
      subject: 'Hello',
      receivedAt: timestamp,
      bodyAvailable: true,
      isDraft: false,
      labelIds: [label],
      attachments: [],
    },
  ],
}
const messageBody = { messageId: message, textBody: 'Hello' }
const resolvedAttachment = {
  mailboxId: mailbox,
  messageId: message,
  attachmentId: attachment,
  providerMessageId: 'provider-message-1',
  providerAttachmentId: 'provider-attachment-1',
  filename: 'file.txt',
  sizeBytes: 1,
}
const draftRecord = {
  id: draft,
  mailboxId: mailbox,
  to: [address],
  cc: [],
  bcc: [],
  subject: 'Hello',
  textBody: 'Hello',
  version: 1,
  revisionFingerprint: fingerprint,
  syncState: 'local' as const,
  updatedAt: timestamp,
}
const mailCommand = { kind: 'set-thread-read' as const, conversationId: conversation, read: true }
const draftCommand = {
  kind: 'sync-draft' as const,
  draftId: draft,
  expectedVersion: 1,
  outboundRevisionFingerprint: fingerprint,
}
const commandReceipt = {
  id: command,
  mailboxId: mailbox,
  state: 'pending' as const,
  command: mailCommand,
  createdAt: timestamp,
}
const storedCommand = {
  ...commandReceipt,
  idempotencyKey: 'key-1',
  entityKey: 'conversation:1',
  attemptCount: 0,
}
const artifactRecord = {
  id: artifact,
  mailboxId: mailbox,
  conversationId: conversation,
  artifactType: 'conversation_summary' as const,
  sourceVersion: 1,
  model: 'model-1',
  policyVersion: 'policy-1',
  content: 'Summary',
  createdAt: timestamp,
}
const fence = { ownerId: 'owner-1', fencingToken: 1, now: timestamp }
const lease = { mailboxId: mailbox, ownerId: 'owner-1', fencingToken: 1, expiresAt: timestamp }
const changes = {}
const batchPage = { kind: 'messages' as const, processedCount: 1 }

export const databaseRpcFixtures = {
  listMailboxes: { input: undefined, result: [mailboxSummary] },
  listConversations: {
    input: { requestId: request, mailboxId: mailbox },
    result: conversationPage,
  },
  listLabels: { input: mailbox, result: [labelSummary] },
  getConversation: {
    input: { requestId: request, mailboxId: mailbox, conversationId: conversation },
    result: conversationDetail,
  },
  getMessageBody: {
    input: {
      requestId: request,
      mailboxId: mailbox,
      conversationId: conversation,
      messageId: message,
    },
    result: messageBody,
  },
  getAttachmentForExport: {
    input: { mailboxId: mailbox, messageId: message, attachmentId: attachment },
    result: resolvedAttachment,
  },
  markAttachmentCached: {
    input: {
      mailboxId: mailbox,
      messageId: message,
      attachmentId: attachment,
      relativePath: 'attachments/file.txt',
    },
    result: undefined,
  },
  getMessageBodies: {
    input: {
      mailboxId: mailbox,
      conversationId: conversation,
      messageIds: [message],
      maxBodyBytes: 1,
    },
    result: { bodies: [messageBody], truncated: false },
  },
  loadAiSourceSnapshot: {
    input: {
      mailboxId: mailbox,
      conversationId: conversation,
      expectedVersion: 1,
      artifactType: 'conversation_summary' as const,
      maxBodyBytes: 1,
    },
    result: { conversation: conversationDetail, bodies: [messageBody], truncated: false },
  },
  searchMail: {
    input: { requestId: request, mailboxId: mailbox, query: 'hello' },
    result: {
      items: [
        {
          messageId: message,
          conversationId: conversation,
          subject: 'Hello',
          sender: address,
          receivedAt: timestamp,
          excerpt: 'Hello',
          rank: 1,
        },
      ],
      indexing: false,
    },
  },
  backfillSearchIndex: {
    input: { mailboxId: mailbox, limit: 1, updatedAt: timestamp },
    result: true,
  },
  getMailbox: { input: mailbox, result: mailboxRecord },
  saveConnectedMailbox: {
    input: { mailbox: mailboxRecord, checkpoint, encryptedRefreshToken: new Uint8Array([1]) },
    result: undefined,
  },
  removeMailbox: { input: { mailboxId: mailbox, removeLocalData: false }, result: undefined },
  getEncryptedRefreshToken: { input: mailbox, result: new Uint8Array([1]) },
  getAiConfiguration: {
    input: mailbox,
    result: { mailboxId: mailbox, baseUrl: 'https://example.com', model: 'model-1' },
  },
  saveAiConfiguration: {
    input: {
      mailboxId: mailbox,
      baseUrl: 'https://example.com',
      model: 'model-1',
      updatedAt: timestamp,
    },
    result: undefined,
  },
  clearAiConfiguration: { input: { mailboxId: mailbox }, result: undefined },
  setAiConfigurationValidated: {
    input: { mailboxId: mailbox, validatedAt: timestamp },
    result: undefined,
  },
  findAiArtifact: {
    input: {
      mailboxId: mailbox,
      conversationId: conversation,
      artifactType: 'conversation_summary' as const,
      sourceVersion: 1,
      model: 'model-1',
      policyVersion: 'policy-1',
    },
    result: artifactRecord,
  },
  getAiArtifact: { input: { mailboxId: mailbox, artifactId: artifact }, result: artifactRecord },
  saveAiArtifactIfCurrent: { input: artifactRecord, result: true },
  saveAiArtifact: { input: artifactRecord, result: undefined },
  acceptAiReply: {
    input: {
      mailboxId: mailbox,
      artifactId: artifact,
      expectedDraftVersion: 1,
      idempotencyKey: 'key-1',
      updatedAt: timestamp,
    },
    result: draftRecord,
  },
  reviewAiArtifact: {
    input: {
      mailboxId: mailbox,
      artifactId: artifact,
      decision: 'accepted' as const,
      reviewedAt: timestamp,
    },
    result: undefined,
  },
  getSyncCheckpoint: { input: mailbox, result: checkpoint },
  acquireSyncLease: {
    input: { mailboxId: mailbox, ownerId: 'owner-1', now: timestamp, expiresAt: timestamp },
    result: lease,
  },
  renewSyncLease: { input: { mailboxId: mailbox, ...fence, expiresAt: timestamp }, result: true },
  releaseSyncLease: {
    input: { mailboxId: mailbox, ownerId: 'owner-1', fencingToken: 1 },
    result: true,
  },
  enqueueCommand: {
    input: {
      id: command,
      mailboxId: mailbox,
      idempotencyKey: 'key-1',
      command: mailCommand,
      createdAt: timestamp,
    },
    result: commandReceipt,
  },
  enqueueInverseCommand: {
    input: {
      id: command,
      mailboxId: mailbox,
      sourceCommandId: command,
      idempotencyKey: 'key-1',
      createdAt: timestamp,
    },
    result: commandReceipt,
  },
  enqueueDraftCommand: {
    input: {
      id: command,
      mailboxId: mailbox,
      idempotencyKey: 'key-1',
      command: draftCommand,
      createdAt: timestamp,
    },
    result: { ...commandReceipt, command: draftCommand },
  },
  claimNextCommand: { input: { now: timestamp, leaseExpiresAt: timestamp }, result: storedCommand },
  resolveProviderCommand: {
    input: storedCommand,
    result: { mailboxId: mailbox, command: mailCommand },
  },
  completeCommand: {
    input: { id: command, mailboxId: mailbox, changes, completedAt: timestamp },
    result: undefined,
  },
  setCommandState: {
    input: { mailboxId: mailbox, id: command, state: 'failed' as const, updatedAt: timestamp },
    result: undefined,
  },
  cancelMailboxCommands: { input: { mailboxId: mailbox, updatedAt: timestamp }, result: undefined },
  listCommandIssues: { input: mailbox, result: [commandReceipt] },
  saveDraft: {
    input: {
      request: {
        requestId: request,
        mailboxId: mailbox,
        idempotencyKey: 'key-1',
        to: [address],
        cc: [],
        bcc: [],
        subject: 'Hello',
        textBody: 'Hello',
      },
      id: draft,
      internetMessageId: '<draft@example.com>',
      updatedAt: timestamp,
    },
    result: draftRecord,
  },
  getDraft: { input: { mailboxId: mailbox, draftId: draft }, result: draftRecord },
  listDrafts: { input: mailbox, result: [draftRecord] },
  enqueueSendDraft: {
    input: {
      mailboxId: mailbox,
      draftId: draft,
      expectedVersion: 1,
      idempotencyKey: 'key-1',
      createdAt: timestamp,
    },
    result: { ...commandReceipt, command: draftCommand },
  },
  beginDraftReconciliation: {
    input: { mailboxId: mailbox, generation: 'generation-1', fence },
    result: undefined,
  },
  stageDraftReconciliation: {
    input: { mailboxId: mailbox, generation: 'generation-1', drafts: [], fence },
    result: undefined,
  },
  completeDraftReconciliation: {
    input: { mailboxId: mailbox, generation: 'generation-1', completedAt: timestamp, fence },
    result: undefined,
  },
  setImportState: {
    input: { mailboxId: mailbox, state: 'complete' as const, updatedAt: timestamp, fence },
    result: undefined,
  },
  setSyncRetry: { input: { mailboxId: mailbox, updatedAt: timestamp, fence }, result: undefined },
  setMailboxAuthRequired: {
    input: { mailboxId: mailbox, updatedAt: timestamp },
    result: undefined,
  },
  resetHistoryPagination: {
    input: { mailboxId: mailbox, updatedAt: timestamp, fence },
    result: undefined,
  },
  beginFullReconciliation: {
    input: {
      mailboxId: mailbox,
      generation: 'generation-1',
      historyStartCursor: 'cursor-1',
      updatedAt: timestamp,
      fence,
    },
    result: undefined,
  },
  stageFullReconciliation: {
    input: {
      mailboxId: mailbox,
      generation: 'generation-1',
      batch: changes,
      pageComplete: true,
      updatedAt: timestamp,
      fence,
    },
    result: undefined,
  },
  completeFullReconciliation: {
    input: { mailboxId: mailbox, generation: 'generation-1', updatedAt: timestamp, fence },
    result: undefined,
  },
  setImportStart: {
    input: { mailboxId: mailbox, historyStartCursor: 'cursor-1', updatedAt: timestamp, fence },
    result: undefined,
  },
  applyImportBatch: {
    input: { mailboxId: mailbox, batch: changes, page: batchPage, updatedAt: timestamp, fence },
    result: undefined,
  },
  applyHistoryPage: {
    input: {
      mailboxId: mailbox,
      batch: changes,
      targetCursor: 'cursor-1',
      updatedAt: timestamp,
      fence,
    },
    result: undefined,
  },
  completeHistory: {
    input: {
      mailboxId: mailbox,
      batch: changes,
      providerCursor: 'cursor-1',
      completedAt: timestamp,
      fence,
    },
    result: undefined,
  },
  resetInitialImport: {
    input: { mailboxId: mailbox, updatedAt: timestamp, fence },
    result: undefined,
  },
  runPostImportMaintenance: { input: { mailboxId: mailbox, analyzedAt: timestamp }, result: true },
} satisfies {
  [Method in DatabaseMethod]: {
    input: DatabaseMethodInput<Method>
    result: DatabaseMethodResult<Method>
  }
}

export const databaseRpcFixtureMethods = Object.keys(databaseRpcFixtures) as DatabaseMethod[]
export type DatabaseRpcFixtureStore = Pick<MailStore, DatabaseMethod>
