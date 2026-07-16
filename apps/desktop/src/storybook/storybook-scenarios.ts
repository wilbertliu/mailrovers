import type {
  AiConfigurationStatus,
  AiStreamEvent,
  AiStreamReceipt,
  ApplicationError,
  CommandReceipt,
  ConnectGmailResult,
  ConversationDetail,
  ConversationPage,
  DesktopEvent,
  Draft,
  ExportAttachmentResult,
  LabelSummary,
  MailboxSummary,
  MessageBody,
  SearchPage,
  SendDraftReceipt,
  SyncReceipt,
  SyncStatus,
} from '@mailrovers/mail-contracts'
import { operationId } from '@mailrovers/mail-domain'
import { storybookFixtures, storybookIds } from './storybook-fixtures.js'

export type ScenarioResponse<Value> =
  | { kind: 'success'; value: Value; delayMs?: number | undefined }
  | { kind: 'failure'; error: ApplicationError; delayMs?: number | undefined }
  | { kind: 'pending' }

export type ScenarioSequence<Value> =
  | ScenarioResponse<Value>
  | readonly [ScenarioResponse<Value>, ...ScenarioResponse<Value>[]]

export type TimedEvent<Event> = { event: Event; delayMs: number }

export type StorybookScenario = {
  name: string
  data: {
    mailboxes: MailboxSummary[]
    labels: LabelSummary[]
    conversations: ConversationPage
    conversation?: ConversationDetail | undefined
    drafts: Draft[]
    commandIssues: CommandReceipt[]
    search: SearchPage
    aiConfiguration: AiConfigurationStatus
    syncStatus: SyncStatus
  }
  responses?: {
    listMailboxes?: ScenarioSequence<MailboxSummary[]> | undefined
    connectGmail?: ScenarioSequence<ConnectGmailResult> | undefined
    disconnectMailbox?: ScenarioSequence<null> | undefined
    startSync?: ScenarioSequence<SyncReceipt> | undefined
    getSyncStatus?: ScenarioSequence<SyncStatus> | undefined
    cancelOperation?: ScenarioSequence<null> | undefined
    listConversations?: ScenarioSequence<ConversationPage> | undefined
    listLabels?: ScenarioSequence<LabelSummary[]> | undefined
    getConversation?: ScenarioSequence<ConversationDetail | null> | undefined
    getMessageBody?: ScenarioSequence<MessageBody | null> | undefined
    exportAttachment?: ScenarioSequence<ExportAttachmentResult> | undefined
    searchMail?: ScenarioSequence<SearchPage> | undefined
    executeCommand?: ScenarioSequence<CommandReceipt> | undefined
    undoCommand?: ScenarioSequence<CommandReceipt> | undefined
    listCommandIssues?: ScenarioSequence<CommandReceipt[]> | undefined
    resolveCommand?: ScenarioSequence<null> | undefined
    saveDraft?: ScenarioSequence<Draft> | undefined
    listDrafts?: ScenarioSequence<Draft[]> | undefined
    sendDraft?: ScenarioSequence<SendDraftReceipt> | undefined
    getAiConfiguration?: ScenarioSequence<AiConfigurationStatus> | undefined
    saveAiConfiguration?: ScenarioSequence<AiConfigurationStatus> | undefined
    clearAiConfiguration?: ScenarioSequence<null> | undefined
    validateAiConfiguration?: ScenarioSequence<AiConfigurationStatus> | undefined
    startConversationSummary?: ScenarioSequence<AiStreamReceipt> | undefined
    startReplyDraft?: ScenarioSequence<AiStreamReceipt> | undefined
    acceptAiReply?: ScenarioSequence<Draft> | undefined
    reviewAiArtifact?: ScenarioSequence<null> | undefined
  }
  syncEvents?: readonly TimedEvent<DesktopEvent>[] | undefined
  aiEvents?: readonly TimedEvent<AiStreamEvent>[] | undefined
  dialogs?: {
    confirm?: boolean | undefined
    prompt?: string | null | undefined
  }
}

export function success<Value>(value: Value, delayMs?: number): ScenarioResponse<Value> {
  return { kind: 'success', value, ...(delayMs === undefined ? {} : { delayMs }) }
}

export function pending<Value>(): ScenarioResponse<Value> {
  return { kind: 'pending' }
}

export function failure<Value>(
  message: string,
  options?: {
    code?: ApplicationError['code'] | undefined
    retryable?: boolean | undefined
    delayMs?: number | undefined
  },
): ScenarioResponse<Value> {
  return {
    kind: 'failure',
    error: {
      code: options?.code ?? 'APPLICATION_ERROR',
      message,
      retryable: options?.retryable ?? true,
      requestId: 'storybook-request',
    },
    ...(options?.delayMs === undefined ? {} : { delayMs: options.delayMs }),
  }
}

const baseData: StorybookScenario['data'] = {
  mailboxes: [storybookFixtures.primaryMailbox, storybookFixtures.secondaryMailbox],
  labels: storybookFixtures.labels,
  conversations: storybookFixtures.conversations,
  conversation: storybookFixtures.launchConversation,
  drafts: [storybookFixtures.draft],
  commandIssues: [],
  search: storybookFixtures.searchResults,
  aiConfiguration: storybookFixtures.aiConfiguration,
  syncStatus: storybookFixtures.syncStatus,
}

function scenario(
  name: string,
  input?: {
    data?: Partial<StorybookScenario['data']> | undefined
    responses?: StorybookScenario['responses'] | undefined
    syncEvents?: StorybookScenario['syncEvents'] | undefined
    aiEvents?: StorybookScenario['aiEvents'] | undefined
    dialogs?: StorybookScenario['dialogs'] | undefined
  },
): StorybookScenario {
  return {
    name,
    data: { ...baseData, ...input?.data },
    ...(input?.responses === undefined ? {} : { responses: input.responses }),
    ...(input?.syncEvents === undefined ? {} : { syncEvents: input.syncEvents }),
    ...(input?.aiEvents === undefined ? {} : { aiEvents: input.aiEvents }),
    ...(input?.dialogs === undefined ? {} : { dialogs: input.dialogs }),
  }
}

function importScenario(
  name: string,
  phase: SyncStatus['phase'],
  values: {
    imported: number
    total?: number | undefined
    mailboxState?: MailboxSummary['syncState'] | undefined
  },
): StorybookScenario {
  const mailbox = {
    ...storybookFixtures.primaryMailbox,
    syncState:
      values.mailboxState ??
      (phase === 'paused' || phase === 'failed' || phase === 'auth_required' ? phase : 'importing'),
    importedMessageCount: values.imported,
    ...(values.total === undefined ? {} : { importTotalEstimate: values.total }),
  } satisfies MailboxSummary
  const syncStatus = {
    mailboxId: storybookIds.mailbox,
    phase,
    importedMessageCount: values.imported,
    importedDraftCount: 6,
    ...(values.total === undefined ? {} : { totalEstimate: values.total }),
  } satisfies SyncStatus
  return scenario(name, {
    data: { mailboxes: [mailbox], syncStatus },
    responses: {
      startSync: success(storybookFixtures.syncReceipt),
      getSyncStatus: success(syncStatus),
    },
  })
}

function derivedScenario(
  name: string,
  base: StorybookScenario,
  input?: {
    data?: Partial<StorybookScenario['data']> | undefined
    responses?: StorybookScenario['responses'] | undefined
    syncEvents?: StorybookScenario['syncEvents'] | undefined
    aiEvents?: StorybookScenario['aiEvents'] | undefined
    dialogs?: StorybookScenario['dialogs'] | undefined
  },
): StorybookScenario {
  return scenario(name, {
    data: { ...base.data, ...input?.data },
    responses: { ...base.responses, ...input?.responses },
    ...(input?.syncEvents === undefined ? {} : { syncEvents: input.syncEvents }),
    ...(input?.aiEvents === undefined ? {} : { aiEvents: input.aiEvents }),
    ...(input?.dialogs === undefined ? {} : { dialogs: input.dialogs }),
  })
}

const connectedImportMailbox = {
  ...storybookFixtures.primaryMailbox,
  syncState: 'importing',
  importedMessageCount: 0,
  importTotalEstimate: 12_482,
} satisfies MailboxSummary

const completedSyncStatus = {
  ...storybookFixtures.syncStatus,
  phase: 'complete',
} satisfies SyncStatus

const cancelledSyncStatus = {
  ...storybookFixtures.syncStatus,
  phase: 'paused',
} satisfies SyncStatus

export const storybookScenarios = {
  mailboxOpening: scenario('Opening local mailbox', {
    responses: { listMailboxes: pending() },
  }),
  mailboxError: scenario('Local mailbox error', {
    responses: { listMailboxes: failure('The local mailbox database could not be opened.') },
  }),
  mailboxRetrying: scenario('Retrying local mailbox', {
    responses: {
      listMailboxes: [failure('The local mailbox database could not be opened.'), pending()],
    },
  }),
  noAccounts: scenario('No connected accounts', { data: { mailboxes: [] } }),
  connecting: scenario('Waiting for Google authorization', {
    data: { mailboxes: [] },
    responses: { connectGmail: pending() },
  }),
  cancellingConnection: scenario('Cancelling Google authorization', {
    data: { mailboxes: [] },
    responses: { connectGmail: pending(), cancelOperation: pending() },
  }),
  addAccount: scenario('Add another Gmail account'),
  connectFailed: scenario('Google authorization failed', {
    data: { mailboxes: [] },
    responses: { connectGmail: failure('Google authorization could not be completed.') },
  }),
  cancelConnectionFailed: scenario('Google authorization cancellation failed', {
    data: { mailboxes: [] },
    responses: {
      connectGmail: pending(),
      cancelOperation: failure('The authorization window could not be cancelled.'),
    },
  }),
  connectionSucceeded: scenario('Google authorization completed', {
    data: { mailboxes: [] },
    responses: {
      listMailboxes: [success([]), success([connectedImportMailbox])],
      connectGmail: success({
        mailbox: connectedImportMailbox,
        sync: storybookFixtures.syncReceipt,
      }),
      getSyncStatus: success({
        ...storybookFixtures.syncStatus,
        phase: 'importing_labels',
        importedMessageCount: 0,
      }),
    },
  }),
  importEstimating: importScenario('Estimating import', 'idle', { imported: 0 }),
  importLabels: importScenario('Importing labels', 'importing_labels', {
    imported: 0,
    total: 12_482,
  }),
  importMessages: importScenario('Importing messages', 'importing_messages', {
    imported: 4_826,
    total: 12_482,
  }),
  importDrafts: importScenario('Importing drafts', 'importing_drafts', {
    imported: 12_312,
    total: 12_482,
  }),
  importReconciling: importScenario('Reconciling Gmail history', 'reconciling_history', {
    imported: 12_482,
    total: 12_482,
    mailboxState: 'reconciling',
  }),
  importPaused: importScenario('Paused import', 'paused', {
    imported: 4_826,
    total: 12_482,
  }),
  importFailed: importScenario('Failed import', 'failed', {
    imported: 4_826,
    total: 12_482,
  }),
  importAuthRequired: importScenario('Authorization required', 'auth_required', {
    imported: 4_826,
    total: 12_482,
  }),
  importStatusError: derivedScenario(
    'Import status unavailable',
    importScenario('Import status base', 'paused', { imported: 4_826, total: 12_482 }),
    { responses: { getSyncStatus: failure('The current import status could not be loaded.') } },
  ),
  importStartFailed: derivedScenario(
    'Import could not start',
    importScenario('Import start base', 'importing_messages', {
      imported: 4_826,
      total: 12_482,
    }),
    { responses: { startSync: failure('The Gmail import could not be resumed.') } },
  ),
  importPausing: derivedScenario(
    'Pausing import',
    importScenario('Import pause base', 'importing_messages', {
      imported: 4_826,
      total: 12_482,
    }),
    { responses: { cancelOperation: pending() } },
  ),
  importResuming: derivedScenario(
    'Resuming import',
    importScenario('Import resume base', 'paused', { imported: 4_826, total: 12_482 }),
    { responses: { startSync: pending() } },
  ),
  importRetrying: derivedScenario(
    'Retrying failed import',
    importScenario('Import retry base', 'failed', { imported: 4_826, total: 12_482 }),
    { responses: { startSync: pending() } },
  ),
  importDisconnecting: derivedScenario(
    'Disconnecting during import',
    importScenario('Import disconnect base', 'paused', { imported: 4_826, total: 12_482 }),
    {
      responses: { disconnectMailbox: pending() },
      dialogs: { confirm: true },
    },
  ),
  workspace: scenario('Populated workspace'),
  emptyInbox: scenario('Empty inbox', {
    data: { conversations: { items: [] }, drafts: [] },
  }),
  inboxLoading: scenario('Loading inbox', {
    responses: { listConversations: pending() },
  }),
  inboxError: scenario('Inbox failed to load', {
    responses: { listConversations: failure('The local inbox could not be loaded.') },
  }),
  labelsLoading: scenario('Loading mailbox labels', {
    responses: { listLabels: pending() },
  }),
  labelsError: scenario('Mailbox labels failed to load', {
    responses: { listLabels: failure('Mailbox labels could not be loaded.') },
  }),
  disconnected: scenario('Offline cache retained', {
    data: {
      mailboxes: [
        {
          ...storybookFixtures.primaryMailbox,
          connectionState: 'disconnected',
        },
      ],
    },
  }),
  commandIssue: scenario('Command needs review', {
    data: { commandIssues: [storybookFixtures.commandIssue] },
  }),
  genericCommandIssue: scenario('Gmail change needs review', {
    data: { commandIssues: [storybookFixtures.genericCommandIssue] },
  }),
  commandIssueResolved: scenario('Command review resolved', {
    data: { commandIssues: [storybookFixtures.commandIssue] },
    responses: {
      listCommandIssues: [success([storybookFixtures.commandIssue]), success([])],
    },
  }),
  mailboxRefreshError: scenario('Cached mailboxes after refresh failure', {
    responses: {
      listMailboxes: [
        success([storybookFixtures.primaryMailbox, storybookFixtures.secondaryMailbox]),
        failure('The mailbox list could not be refreshed.'),
      ],
    },
    syncEvents: [
      {
        delayMs: 50,
        event: {
          kind: 'mail-changed',
          requestId: operationId('storybook-mailbox-change'),
          changes: { mailboxes: true },
        },
      },
    ],
  }),
  refreshing: scenario('Manual refresh in progress', {
    responses: { startSync: pending() },
  }),
  refreshFailed: scenario('Manual refresh failure', {
    responses: { startSync: failure('Gmail could not be reached. Check your connection.') },
  }),
  refreshComplete: scenario('Manual refresh completed', {
    syncEvents: [
      {
        delayMs: 50,
        event: {
          kind: 'sync-completed',
          requestId: storybookIds.syncOperation,
          mailboxId: storybookIds.mailbox,
          status: completedSyncStatus,
        },
      },
    ],
  }),
  refreshCancelled: scenario('Manual refresh cancelled', {
    syncEvents: [
      {
        delayMs: 50,
        event: {
          kind: 'sync-cancelled',
          requestId: storybookIds.syncOperation,
          mailboxId: storybookIds.mailbox,
          status: cancelledSyncStatus,
        },
      },
    ],
  }),
  refreshDeferred: scenario('Manual refresh deferred', {
    responses: {
      startSync: success({
        requestId: storybookIds.syncOperation,
        mailboxId: storybookIds.mailbox,
        state: 'deferred',
        retryAt: storybookFixtures.now,
      }),
    },
  }),
  refreshAlreadyActive: scenario('Manual refresh already active', {
    responses: {
      startSync: success({
        requestId: operationId('storybook-existing-sync-operation'),
        mailboxId: storybookIds.mailbox,
        state: 'active',
      }),
    },
  }),
  searchResults: scenario('Search results'),
  searchLoading: scenario('Search in progress', {
    responses: { searchMail: pending() },
  }),
  searchEmpty: scenario('No search results', {
    data: { search: { items: [], indexing: false } },
  }),
  searchIndexing: scenario('Search while indexing', {
    data: { search: { items: [], indexing: true } },
  }),
  searchError: scenario('Search failed', {
    responses: { searchMail: failure('Search could not be completed.') },
  }),
  drafts: scenario('Local drafts'),
  emptyDrafts: scenario('No local drafts', {
    data: { drafts: [] },
  }),
  draftsLoading: scenario('Loading local drafts', {
    responses: { listDrafts: pending() },
  }),
  aiSettings: scenario('Configured AI provider'),
  aiSettingsUnconfigured: scenario('Unconfigured AI provider', {
    data: { aiConfiguration: storybookFixtures.emptyAiConfiguration },
  }),
  aiSettingsLoading: scenario('Loading AI provider settings', {
    responses: { getAiConfiguration: pending() },
  }),
  aiSettingsError: scenario('AI provider settings error', {
    responses: { getAiConfiguration: failure('The encrypted AI configuration could not be read.') },
  }),
  aiSettingsSaving: scenario('Saving AI provider settings', {
    responses: { saveAiConfiguration: pending() },
  }),
  aiSettingsSaveFailed: scenario('Saving AI provider settings failed', {
    responses: { saveAiConfiguration: failure('The AI provider settings could not be saved.') },
  }),
  aiSettingsTesting: scenario('Testing AI provider settings', {
    responses: { validateAiConfiguration: pending() },
  }),
  aiSettingsTestFailed: scenario('Testing AI provider settings failed', {
    responses: {
      validateAiConfiguration: failure('The AI provider could not be reached.', {
        code: 'AI_PROVIDER_UNAVAILABLE',
      }),
    },
  }),
  aiSettingsRemoved: scenario('AI provider settings removed', {
    responses: {
      getAiConfiguration: [
        success(storybookFixtures.aiConfiguration),
        success(storybookFixtures.emptyAiConfiguration),
      ],
    },
    dialogs: { confirm: true },
  }),
  composer: scenario('New message composer'),
  composerSaving: scenario('Saving local draft', {
    responses: { saveDraft: pending() },
  }),
  composerSaveFailed: scenario('Saving local draft failed', {
    responses: { saveDraft: failure('The draft could not be saved locally.') },
  }),
  composerSending: scenario('Queueing message', {
    responses: { sendDraft: pending() },
  }),
  composerSendFailed: scenario('Queueing message failed', {
    responses: { sendDraft: failure('The message could not be queued.') },
  }),
  conversation: scenario('Open conversation'),
  conversationLoading: scenario('Loading conversation', {
    responses: { getConversation: pending() },
  }),
  conversationError: scenario('Conversation failed to load', {
    responses: { getConversation: failure('The conversation could not be opened.') },
  }),
  messageBodyLoading: scenario('Loading message body', {
    responses: { getMessageBody: pending() },
  }),
  messageWithoutReadableBody: scenario('Message without readable body', {
    responses: { getMessageBody: success(null) },
  }),
  htmlMessageBody: scenario('HTML message body', {
    responses: {
      getMessageBody: success({
        messageId: storybookIds.launchReply,
        sanitizedHtmlBody:
          '<main><h2>Launch ready</h2><p>Everything is ready on my side.</p></main>',
      }),
    },
  }),
  attachmentExporting: scenario('Exporting attachment', {
    responses: { exportAttachment: pending() },
  }),
  attachmentExportCancelled: scenario('Attachment export cancelled', {
    responses: {
      exportAttachment: success({
        status: 'cancelled',
        attachmentId: storybookIds.launchAttachment,
      }),
    },
  }),
  attachmentExportFailed: scenario('Attachment export failed', {
    responses: { exportAttachment: failure('The attachment could not be exported.') },
  }),
  attachmentUnavailable: scenario('Attachment unavailable', {
    data: {
      conversation: {
        ...storybookFixtures.launchConversation,
        messages: storybookFixtures.launchConversation.messages.map((message) => ({
          ...message,
          attachments: message.attachments.map((attachment) => ({
            ...attachment,
            availability: 'unavailable',
          })),
        })),
      },
    },
  }),
  archiveUndo: scenario('Archive with undo', {
    responses: { executeCommand: success(storybookFixtures.commandReceipt) },
  }),
  aiSummaryStreaming: scenario('Streaming conversation summary', {
    aiEvents: [
      {
        delayMs: 50,
        event: {
          kind: 'ai-started',
          requestId: storybookIds.aiOperation,
          mailboxId: storybookIds.mailbox,
          artifactType: 'conversation_summary',
          sourceVersion: 7,
          cached: false,
        },
      },
      {
        delayMs: 250,
        event: {
          kind: 'ai-delta',
          requestId: storybookIds.aiOperation,
          mailboxId: storybookIds.mailbox,
          text: 'Maya completed the launch review and updated the checklist…',
        },
      },
    ],
  }),
  aiSummaryComplete: scenario('Completed conversation summary', {
    aiEvents: [
      {
        delayMs: 25,
        event: {
          kind: 'ai-completed',
          requestId: storybookIds.aiOperation,
          mailboxId: storybookIds.mailbox,
          artifact: storybookFixtures.aiArtifact,
        },
      },
    ],
  }),
  aiSummaryError: scenario('Failed conversation summary', {
    aiEvents: [
      {
        delayMs: 25,
        event: {
          kind: 'ai-failed',
          requestId: storybookIds.aiOperation,
          mailboxId: storybookIds.mailbox,
          error: {
            code: 'AI_PROVIDER_UNAVAILABLE',
            message: 'The AI provider is temporarily unavailable.',
            retryable: true,
            requestId: storybookIds.aiOperation,
          },
        },
      },
    ],
  }),
  aiSummaryStartFailed: scenario('Conversation summary could not start', {
    responses: {
      startConversationSummary: failure('The AI summary could not be started.', {
        code: 'AI_PROVIDER_UNAVAILABLE',
      }),
    },
  }),
  aiReplyStreaming: scenario('Streaming AI reply', {
    responses: {
      saveDraft: success(storybookFixtures.draft),
      startReplyDraft: success({
        ...storybookFixtures.aiReceipt,
        artifactType: 'reply_draft',
      }),
    },
    aiEvents: [
      {
        delayMs: 25,
        event: {
          kind: 'ai-delta',
          requestId: storybookIds.aiOperation,
          mailboxId: storybookIds.mailbox,
          text: 'Thanks, Maya. I reviewed the checklist…',
        },
      },
    ],
  }),
  aiReplyError: scenario('AI reply failed', {
    responses: {
      saveDraft: success(storybookFixtures.draft),
      startReplyDraft: success({
        ...storybookFixtures.aiReceipt,
        artifactType: 'reply_draft',
      }),
    },
    aiEvents: [
      {
        delayMs: 25,
        event: {
          kind: 'ai-failed',
          requestId: storybookIds.aiOperation,
          mailboxId: storybookIds.mailbox,
          error: {
            code: 'AI_PROVIDER_UNAVAILABLE',
            message: 'The AI provider could not draft a reply.',
            retryable: true,
            requestId: storybookIds.aiOperation,
          },
        },
      },
    ],
  }),
  aiReplyStartFailed: scenario('AI reply could not start', {
    responses: {
      saveDraft: success(storybookFixtures.draft),
      startReplyDraft: failure('The AI reply could not be started.', {
        code: 'AI_PROVIDER_UNAVAILABLE',
      }),
    },
  }),
  aiReplyComplete: scenario('Completed AI reply', {
    responses: {
      saveDraft: success(storybookFixtures.draft),
      startReplyDraft: success({
        ...storybookFixtures.aiReceipt,
        artifactType: 'reply_draft',
      }),
    },
    aiEvents: [
      {
        delayMs: 25,
        event: {
          kind: 'ai-completed',
          requestId: storybookIds.aiOperation,
          mailboxId: storybookIds.mailbox,
          artifact: storybookFixtures.aiReplyArtifact,
        },
      },
    ],
  }),
} satisfies Record<string, StorybookScenario>
