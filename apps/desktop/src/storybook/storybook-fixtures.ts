import type {
  AiArtifact,
  AiConfigurationStatus,
  AiStreamReceipt,
  CommandReceipt,
  ConnectGmailResult,
  ConversationDetail,
  ConversationPage,
  Draft,
  LabelSummary,
  MailboxSummary,
  MessageBody,
  SearchPage,
  SendDraftReceipt,
  SyncReceipt,
  SyncStatus,
} from '@mailrovers/mail-contracts'
import { GMAIL_CAPABILITIES } from '@mailrovers/mail-contracts'
import {
  aiArtifactId,
  attachmentId,
  commandId,
  conversationId,
  draftId,
  fingerprintDraftRevision,
  labelId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
} from '@mailrovers/mail-domain'

const now = utcTimestamp('2026-07-16T08:30:00.000Z')
const yesterday = utcTimestamp('2026-07-15T04:15:00.000Z')
const lastWeek = utcTimestamp('2026-07-09T10:00:00.000Z')

export const storybookIds = {
  mailbox: mailboxId('storybook-primary-mailbox'),
  secondaryMailbox: mailboxId('storybook-secondary-mailbox'),
  inbox: labelId('storybook-inbox-label'),
  sent: labelId('storybook-sent-label'),
  travel: labelId('storybook-travel-label'),
  launchConversation: conversationId('storybook-launch-conversation'),
  invoiceConversation: conversationId('storybook-invoice-conversation'),
  teamConversation: conversationId('storybook-team-conversation'),
  launchMessage: messageId('storybook-launch-message'),
  launchReply: messageId('storybook-launch-reply'),
  invoiceMessage: messageId('storybook-invoice-message'),
  launchAttachment: attachmentId('storybook-launch-pdf'),
  draft: draftId('storybook-draft'),
  syncOperation: operationId('storybook-sync-operation'),
  aiOperation: operationId('storybook-ai-operation'),
}

const primaryMailbox = {
  id: storybookIds.mailbox,
  provider: 'gmail',
  emailAddress: 'alex@example.com',
  displayName: 'Alex Morgan',
  syncState: 'ready',
  connectionState: 'connected',
  capabilities: GMAIL_CAPABILITIES,
  importedMessageCount: 12_482,
  importTotalEstimate: 12_482,
  lastSuccessfulSyncAt: now,
} satisfies MailboxSummary

const secondaryMailbox = {
  ...primaryMailbox,
  id: storybookIds.secondaryMailbox,
  emailAddress: 'alex@studio.example',
  displayName: 'Alex at Studio',
  importedMessageCount: 3_291,
  importTotalEstimate: 3_291,
} satisfies MailboxSummary

const labels = [
  {
    id: storybookIds.inbox,
    mailboxId: storybookIds.mailbox,
    providerLabelId: 'INBOX',
    name: 'Inbox',
    kind: 'system',
    conversationCount: 38,
    unreadCount: 4,
  },
  {
    id: storybookIds.sent,
    mailboxId: storybookIds.mailbox,
    providerLabelId: 'SENT',
    name: 'Sent',
    kind: 'system',
    conversationCount: 112,
    unreadCount: 0,
  },
  {
    id: storybookIds.travel,
    mailboxId: storybookIds.mailbox,
    providerLabelId: 'Label_Travel',
    name: 'Travel',
    kind: 'user',
    color: { backgroundColor: '#d7e8ff', textColor: '#17365d' },
    conversationCount: 7,
    unreadCount: 1,
  },
] satisfies LabelSummary[]

const conversations = {
  items: [
    {
      id: storybookIds.launchConversation,
      mailboxId: storybookIds.mailbox,
      subject: 'Launch checklist and final copy',
      snippet: 'The final review is complete. I left two small notes on the launch email…',
      lastMessageAt: now,
      messageCount: 2,
      unreadCount: 1,
      hasAttachments: true,
      version: 7,
    },
    {
      id: storybookIds.invoiceConversation,
      mailboxId: storybookIds.mailbox,
      subject: 'Invoice for July',
      snippet: 'Attached is the July invoice. The payment date remains August 1.',
      lastMessageAt: yesterday,
      messageCount: 1,
      unreadCount: 0,
      hasAttachments: true,
      version: 2,
    },
    {
      id: storybookIds.teamConversation,
      mailboxId: storybookIds.mailbox,
      subject: 'Friday team notes',
      snippet: 'A quick recap of decisions and owners from Friday…',
      lastMessageAt: lastWeek,
      messageCount: 4,
      unreadCount: 3,
      hasAttachments: false,
      version: 9,
    },
  ],
} satisfies ConversationPage

const launchConversation = {
  id: storybookIds.launchConversation,
  mailboxId: storybookIds.mailbox,
  subject: 'Launch checklist and final copy',
  version: 7,
  messages: [
    {
      id: storybookIds.launchMessage,
      conversationId: storybookIds.launchConversation,
      sender: { name: 'Maya Chen', address: 'maya@example.com' },
      recipients: { to: [{ name: 'Alex Morgan', address: 'alex@example.com' }], cc: [], bcc: [] },
      subject: 'Launch checklist and final copy',
      sentAt: yesterday,
      receivedAt: yesterday,
      bodyAvailable: true,
      isDraft: false,
      labelIds: [storybookIds.inbox, storybookIds.travel],
      attachments: [],
    },
    {
      id: storybookIds.launchReply,
      conversationId: storybookIds.launchConversation,
      sender: { name: 'Maya Chen', address: 'maya@example.com' },
      recipients: { to: [{ name: 'Alex Morgan', address: 'alex@example.com' }], cc: [], bcc: [] },
      subject: 'Re: Launch checklist and final copy',
      sentAt: now,
      receivedAt: now,
      bodyAvailable: true,
      isDraft: false,
      labelIds: [storybookIds.inbox],
      attachments: [
        {
          id: storybookIds.launchAttachment,
          filename: 'launch-checklist.pdf',
          mediaType: 'application/pdf',
          sizeBytes: 248_120,
          availability: 'cached',
        },
      ],
    },
  ],
} satisfies ConversationDetail

const messageBodies = new Map<MessageBody['messageId'], MessageBody>([
  [
    storybookIds.launchMessage,
    {
      messageId: storybookIds.launchMessage,
      textBody:
        'Hi Alex,\n\nThe final review is complete. I left two small notes on the launch email and updated the checklist.\n\nMaya',
    },
  ],
  [
    storybookIds.launchReply,
    {
      messageId: storybookIds.launchReply,
      textBody:
        'Everything is ready on my side. Please check the attached launch checklist before we schedule the announcement.\n\nThanks,\nMaya',
    },
  ],
])

const draftFingerprint = fingerprintDraftRevision({
  internetMessageId: '<storybook-draft@example.com>',
  sender: { address: 'alex@example.com' },
  to: [{ name: 'Maya Chen', address: 'maya@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Re: Launch checklist and final copy',
  textBody: 'Thanks Maya. I checked the final list and everything looks ready.',
  references: [],
})

const draft = {
  id: storybookIds.draft,
  mailboxId: storybookIds.mailbox,
  conversationId: storybookIds.launchConversation,
  replyToMessageId: storybookIds.launchReply,
  to: [{ name: 'Maya Chen', address: 'maya@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Re: Launch checklist and final copy',
  textBody: 'Thanks Maya. I checked the final list and everything looks ready.',
  version: 3,
  revisionFingerprint: draftFingerprint,
  syncState: 'local',
  updatedAt: now,
} satisfies Draft

const commandIssue = {
  id: commandId('storybook-command-issue'),
  mailboxId: storybookIds.mailbox,
  state: 'needs_review',
  command: {
    kind: 'send-draft',
    draftId: storybookIds.draft,
    expectedVersion: 3,
    outboundRevisionFingerprint: draftFingerprint,
  },
  createdAt: now,
} satisfies CommandReceipt

const commandReceipt = {
  id: commandId('storybook-command-receipt'),
  mailboxId: storybookIds.mailbox,
  state: 'succeeded',
  command: {
    kind: 'set-thread-archived',
    conversationId: storybookIds.launchConversation,
    archived: true,
  },
  createdAt: now,
} satisfies CommandReceipt

const genericCommandIssue = {
  id: commandId('storybook-generic-command-issue'),
  mailboxId: storybookIds.mailbox,
  state: 'needs_review',
  command: {
    kind: 'set-thread-read',
    conversationId: storybookIds.launchConversation,
    read: true,
  },
  createdAt: now,
} satisfies CommandReceipt

const aiConfiguration = {
  mailboxId: storybookIds.mailbox,
  state: 'valid',
  hasApiKey: true,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5-mini',
  lastValidatedAt: now,
} satisfies AiConfigurationStatus

const emptyAiConfiguration = {
  mailboxId: storybookIds.mailbox,
  state: 'not_configured',
  hasApiKey: false,
} satisfies AiConfigurationStatus

const aiArtifact = {
  id: aiArtifactId('storybook-ai-artifact'),
  mailboxId: storybookIds.mailbox,
  conversationId: storybookIds.launchConversation,
  artifactType: 'conversation_summary',
  sourceVersion: 7,
  model: 'gpt-5-mini',
  policyVersion: 'storybook-v1',
  content:
    'Maya completed the launch review, updated the checklist, and asked Alex to verify the attached PDF before scheduling the announcement.',
  createdAt: now,
} satisfies AiArtifact

const aiReplyArtifact = {
  ...aiArtifact,
  id: aiArtifactId('storybook-ai-reply-artifact'),
  artifactType: 'reply_draft',
  content:
    'Thanks, Maya. I reviewed the final checklist and everything looks ready. I will schedule the announcement this afternoon.',
  draftId: storybookIds.draft,
  draftVersion: 3,
} satisfies AiArtifact

export const storybookFixtures = {
  now,
  primaryMailbox,
  secondaryMailbox,
  labels,
  conversations,
  launchConversation,
  messageBodies,
  draft,
  commandIssue,
  genericCommandIssue,
  commandReceipt,
  aiConfiguration,
  emptyAiConfiguration,
  aiArtifact,
  aiReplyArtifact,
  searchResults: {
    items: [
      {
        messageId: storybookIds.launchReply,
        conversationId: storybookIds.launchConversation,
        subject: launchConversation.subject,
        sender: { name: 'Maya Chen', address: 'maya@example.com' },
        receivedAt: now,
        excerpt: 'Please check the attached launch checklist before we schedule the announcement.',
        rank: 0.98,
      },
    ],
    indexing: false,
  } satisfies SearchPage,
  syncStatus: {
    mailboxId: storybookIds.mailbox,
    phase: 'complete',
    importedMessageCount: 12_482,
    importedDraftCount: 18,
    totalEstimate: 12_482,
  } satisfies SyncStatus,
  syncReceipt: {
    requestId: storybookIds.syncOperation,
    mailboxId: storybookIds.mailbox,
    state: 'active',
  } satisfies SyncReceipt,
  aiReceipt: {
    requestId: storybookIds.aiOperation,
    mailboxId: storybookIds.mailbox,
    conversationId: storybookIds.launchConversation,
    artifactType: 'conversation_summary',
    sourceVersion: 7,
  } satisfies AiStreamReceipt,
  connectResult: {
    mailbox: primaryMailbox,
    sync: {
      requestId: storybookIds.syncOperation,
      mailboxId: storybookIds.mailbox,
      state: 'active',
    },
  } satisfies ConnectGmailResult,
  sendReceipt: {
    commandId: commandId('storybook-send-command'),
    draftId: storybookIds.draft,
    version: 3,
  } satisfies SendDraftReceipt,
}
