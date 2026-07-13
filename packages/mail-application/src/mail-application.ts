import type {
  AcceptAiReplyInput,
  AiArtifact,
  AiConfigurationStatus,
  AiStreamEvent,
  AiStreamReceipt,
  CancelOperationInput,
  ClearAiConfigurationInput,
  CommandReceipt,
  ConnectGmailInput,
  ConnectGmailResult,
  ConversationDetail,
  ConversationPage,
  DisconnectMailboxInput,
  Draft,
  DraftReplyInput,
  ExecuteMailCommandInput,
  GetAiConfigurationInput,
  GetConversationInput,
  GetDraftInput,
  GetSyncStatusInput,
  ListCommandIssuesInput,
  ListConversationsInput,
  ListDraftsInput,
  ListLabelsInput,
  ListMailboxesInput,
  LabelSummary,
  MailboxSummary,
  ResolveCommandInput,
  ReviewAiArtifactInput,
  SaveAiConfigurationInput,
  SaveDraftInput,
  SearchMailInput,
  SearchPage,
  SendDraftInput,
  SendDraftReceipt,
  StartSyncInput,
  SummarizeConversationInput,
  SyncReceipt,
  SyncStatus,
  ValidateAiConfigurationInput,
} from '@mailrovers/mail-contracts'
import {
  aiArtifactId,
  commandId,
  draftId,
  mailboxId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type MailboxId,
  type OperationId,
} from '@mailrovers/mail-domain'
import { recipientFingerprint, selectAiContext } from './ai-context.js'
import { AiApplicationError, AiOperationRegistry } from './ai-operations.js'
import {
  REPLY_POLICY_VERSION,
  SUMMARY_POLICY_VERSION,
  type AiProviderConfiguration,
  type AiRuntimeFactory,
} from './ai-runtime.js'
import type { GmailConnector } from './mail-provider.js'
import type { MailStore, StoredAiConfiguration } from './mail-store.js'
import type { CommandDispatcher, SecretSealer, SyncEngine } from './sync-engine.js'

export interface MailApplication {
  listMailboxes(input: ListMailboxesInput): Promise<MailboxSummary[]>
  connectGmail(input: ConnectGmailInput): Promise<ConnectGmailResult>
  disconnectMailbox(input: DisconnectMailboxInput): Promise<void>
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  listLabels(input: ListLabelsInput): Promise<LabelSummary[]>
  getConversation(input: GetConversationInput): Promise<ConversationDetail | undefined>
  searchMail(input: SearchMailInput): Promise<SearchPage>
  executeCommand(input: ExecuteMailCommandInput): Promise<CommandReceipt>
  listCommandIssues(input: ListCommandIssuesInput): Promise<CommandReceipt[]>
  resolveCommand(input: ResolveCommandInput): Promise<void>
  saveDraft(input: SaveDraftInput): Promise<Draft>
  getDraft(input: GetDraftInput): Promise<Draft | undefined>
  listDrafts(input: ListDraftsInput): Promise<Draft[]>
  sendDraft(input: SendDraftInput): Promise<SendDraftReceipt>
  getAiConfiguration(input: GetAiConfigurationInput): Promise<AiConfigurationStatus>
  saveAiConfiguration(input: SaveAiConfigurationInput): Promise<AiConfigurationStatus>
  clearAiConfiguration(input: ClearAiConfigurationInput): Promise<void>
  validateAiConfiguration(input: ValidateAiConfigurationInput): Promise<AiConfigurationStatus>
  startConversationSummary(input: SummarizeConversationInput): Promise<AiStreamReceipt>
  startReplyDraft(input: DraftReplyInput): Promise<AiStreamReceipt>
  acceptAiReply(input: AcceptAiReplyInput): Promise<Draft>
  reviewAiArtifact(input: ReviewAiArtifactInput): Promise<void>
  startSync(input: StartSyncInput): Promise<SyncReceipt>
  getSyncStatus(input: GetSyncStatusInput): Promise<SyncStatus>
  cancelOperation(input: CancelOperationInput): Promise<void>
}

export interface MailApplicationOperations {
  subscribeOperation(operationId: OperationId): boolean
}

export type MailApplicationDependencies = {
  store: MailStore
  gmailConnector?: GmailConnector | undefined
  secretSealer?: SecretSealer | undefined
  syncEngine?: SyncEngine | undefined
  commandDispatcher?: CommandDispatcher | undefined
  aiRuntimeFactory?: AiRuntimeFactory | undefined
  publishAiEvent?: ((event: AiStreamEvent) => void) | undefined
  now?: (() => Date) | undefined
}

function required<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new Error(`${name} is not configured`)
  return value
}

function configurationStatus(
  mailbox: MailboxId,
  configuration: StoredAiConfiguration | undefined,
): AiConfigurationStatus {
  if (!configuration) return { mailboxId: mailbox, state: 'not_configured', hasApiKey: false }
  const hasApiKey = configuration.encryptedApiKey !== undefined
  return {
    mailboxId: mailbox,
    state:
      hasApiKey && configuration.lastValidatedAt !== undefined
        ? 'valid'
        : hasApiKey
          ? 'configured'
          : 'not_configured',
    hasApiKey,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    ...(configuration.lastValidatedAt === undefined
      ? {}
      : { lastValidatedAt: configuration.lastValidatedAt }),
  }
}

export function createMailApplication(
  input: MailStore | MailApplicationDependencies,
): MailApplication & MailApplicationOperations {
  const dependencies: MailApplicationDependencies = 'store' in input ? input : { store: input }
  const now = dependencies.now ?? (() => new Date())
  const connectionOperations = new Map<OperationId, AbortController>()
  const validationOperations = new Map<OperationId, AbortController>()
  const aiOperations = new AiOperationRegistry(dependencies.publishAiEvent ?? (() => {}))

  const loadAiConfiguration = async (id: MailboxId): Promise<StoredAiConfiguration> => {
    const configuration = await dependencies.store.getAiConfiguration(id)
    if (!configuration?.encryptedApiKey)
      throw new AiApplicationError('AI_CONFIGURATION_INVALID', 'AI is not configured')
    return configuration
  }

  const resolveRuntimeConfiguration = async (
    configuration: StoredAiConfiguration,
  ): Promise<AiProviderConfiguration> => ({
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    apiKey: await required(dependencies.secretSealer, 'Secret sealer').unseal(
      required(configuration.encryptedApiKey, 'AI API key'),
    ),
  })

  const application: MailApplication & MailApplicationOperations = {
    listMailboxes: () => dependencies.store.listMailboxes(),
    listConversations: (request) => dependencies.store.listConversations(request),
    listLabels: (request) => dependencies.store.listLabels(request.mailboxId),
    getConversation: (request) => dependencies.store.getConversation(request),
    searchMail: (request) => dependencies.store.searchMail(request),
    async executeCommand(request) {
      const receipt = await dependencies.store.enqueueCommand({
        id: commandId(request.idempotencyKey),
        mailboxId: request.mailboxId,
        idempotencyKey: request.idempotencyKey,
        command: request.command,
        createdAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return receipt
    },
    listCommandIssues: (request) => dependencies.store.listCommandIssues(request.mailboxId),
    async resolveCommand(request) {
      await dependencies.store.setCommandState({
        id: request.commandId,
        state: request.resolution === 'cancel' ? 'cancelled' : 'pending',
        updatedAt: utcTimestamp(now().toISOString()),
      })
      if (request.resolution !== 'cancel') dependencies.commandDispatcher?.wake()
    },
    async saveDraft(request) {
      const saved = await dependencies.store.saveDraft({
        request,
        id: request.draftId ?? draftId(`draft:${request.idempotencyKey}`),
        internetMessageId: `<${request.draftId ?? request.idempotencyKey}@mailrovers.local>`,
        updatedAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return saved
    },
    getDraft: (request) =>
      dependencies.store.getDraft({ mailboxId: request.mailboxId, draftId: request.draftId }),
    listDrafts: (request) => dependencies.store.listDrafts(request.mailboxId),
    async sendDraft(request) {
      const receipt = await dependencies.store.enqueueSendDraft({
        mailboxId: request.mailboxId,
        draftId: request.draftId,
        expectedVersion: request.expectedVersion,
        idempotencyKey: request.idempotencyKey,
        createdAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return { commandId: receipt.id, draftId: request.draftId, version: request.expectedVersion }
    },
    async getAiConfiguration(request) {
      return configurationStatus(
        request.mailboxId,
        await dependencies.store.getAiConfiguration(request.mailboxId),
      )
    },
    async saveAiConfiguration(request) {
      const existing = await dependencies.store.getAiConfiguration(request.mailboxId)
      const apiKey =
        request.apiKey ??
        (existing?.encryptedApiKey
          ? await required(dependencies.secretSealer, 'Secret sealer').unseal(
              existing.encryptedApiKey,
            )
          : undefined)
      if (!apiKey)
        throw new AiApplicationError('AI_CONFIGURATION_INVALID', 'An AI API key is required')
      const baseUrl = request.baseUrl.trim()
      const model = request.model.trim()
      required(dependencies.aiRuntimeFactory, 'AI runtime').create({ baseUrl, model, apiKey })
      const encryptedApiKey =
        request.apiKey === undefined
          ? undefined
          : await required(dependencies.secretSealer, 'Secret sealer').seal(request.apiKey)
      await dependencies.store.saveAiConfiguration({
        mailboxId: request.mailboxId,
        baseUrl,
        model,
        ...(encryptedApiKey === undefined ? {} : { encryptedApiKey }),
        updatedAt: utcTimestamp(now().toISOString()),
      })
      return configurationStatus(
        request.mailboxId,
        await dependencies.store.getAiConfiguration(request.mailboxId),
      )
    },
    async clearAiConfiguration(request) {
      await dependencies.store.clearAiConfiguration({ mailboxId: request.mailboxId })
    },
    async validateAiConfiguration(request) {
      if (validationOperations.has(request.requestId))
        throw new Error('An operation with this request ID already exists')
      const controller = new AbortController()
      validationOperations.set(request.requestId, controller)
      try {
        const configuration = await loadAiConfiguration(request.mailboxId)
        const runtime = required(dependencies.aiRuntimeFactory, 'AI runtime').create(
          await resolveRuntimeConfiguration(configuration),
        )
        await runtime.validateConfiguration(controller.signal)
        await dependencies.store.setAiConfigurationValidated({
          mailboxId: request.mailboxId,
          validatedAt: utcTimestamp(now().toISOString()),
        })
        return configurationStatus(
          request.mailboxId,
          await dependencies.store.getAiConfiguration(request.mailboxId),
        )
      } finally {
        validationOperations.delete(request.requestId)
      }
    },
    async startConversationSummary(request) {
      const conversation = await dependencies.store.getConversation(request)
      if (!conversation || conversation.version !== request.sourceVersion)
        throw new AiApplicationError('AI_CONTEXT_STALE', 'Conversation changed before generation')
      const configuration = await loadAiConfiguration(request.mailboxId)
      const receipt: AiStreamReceipt = {
        requestId: request.requestId,
        mailboxId: request.mailboxId,
        conversationId: request.conversationId,
        artifactType: 'conversation_summary',
        sourceVersion: request.sourceVersion,
      }
      if (!request.force) {
        const cached = await dependencies.store.findAiArtifact({
          mailboxId: request.mailboxId,
          conversationId: request.conversationId,
          artifactType: 'conversation_summary',
          sourceVersion: request.sourceVersion,
          model: configuration.model,
          policyVersion: SUMMARY_POLICY_VERSION,
        })
        if (cached) return aiOperations.registerCached(receipt, cached)
      }
      const context = selectAiContext(conversation, 'conversation_summary')
      return aiOperations.registerRuntime({
        receipt,
        prepare: async () => ({
          runtime: required(dependencies.aiRuntimeFactory, 'AI runtime').create(
            await resolveRuntimeConfiguration(configuration),
          ),
          request: {
            requestId: request.requestId,
            mailboxId: request.mailboxId,
            conversationId: request.conversationId,
            artifactType: 'conversation_summary',
            sourceVersion: request.sourceVersion,
            policyVersion: SUMMARY_POLICY_VERSION,
            messages: context.messages,
            contextTruncated: context.truncated,
            ...(request.userInstructions === undefined
              ? {}
              : { userInstructions: request.userInstructions }),
          },
        }),
        complete: async (content, model) => {
          const artifact: AiArtifact = {
            id: aiArtifactId(`ai:${request.requestId}`),
            mailboxId: request.mailboxId,
            conversationId: request.conversationId,
            artifactType: 'conversation_summary',
            sourceVersion: request.sourceVersion,
            model,
            policyVersion: SUMMARY_POLICY_VERSION,
            content,
            createdAt: utcTimestamp(now().toISOString()),
          }
          await dependencies.store.saveAiArtifact(artifact)
          return artifact
        },
      })
    },
    async startReplyDraft(request) {
      const conversation = await dependencies.store.getConversation(request)
      if (!conversation || conversation.version !== request.sourceVersion)
        throw new AiApplicationError('AI_CONTEXT_STALE', 'Conversation changed before generation')
      const draft = await dependencies.store.getDraft({
        mailboxId: request.mailboxId,
        draftId: request.draftId,
      })
      if (
        !draft ||
        draft.version !== request.draftVersion ||
        draft.conversationId !== request.conversationId
      )
        throw new AiApplicationError('AI_CONTEXT_STALE', 'Draft changed before generation')
      const configuration = await loadAiConfiguration(request.mailboxId)
      const context = selectAiContext(conversation, 'reply_draft')
      const fingerprint = recipientFingerprint(draft)
      const receipt: AiStreamReceipt = {
        requestId: request.requestId,
        mailboxId: request.mailboxId,
        conversationId: request.conversationId,
        artifactType: 'reply_draft',
        sourceVersion: request.sourceVersion,
      }
      return aiOperations.registerRuntime({
        receipt,
        prepare: async () => ({
          runtime: required(dependencies.aiRuntimeFactory, 'AI runtime').create(
            await resolveRuntimeConfiguration(configuration),
          ),
          request: {
            requestId: request.requestId,
            mailboxId: request.mailboxId,
            conversationId: request.conversationId,
            artifactType: 'reply_draft',
            sourceVersion: request.sourceVersion,
            policyVersion: REPLY_POLICY_VERSION,
            messages: context.messages,
            contextTruncated: context.truncated,
            draft: {
              id: draft.id,
              version: draft.version,
              recipients: [...draft.to, ...draft.cc, ...draft.bcc],
              subject: draft.subject,
              textBody: draft.textBody,
            },
            ...(request.userInstructions === undefined
              ? {}
              : { userInstructions: request.userInstructions }),
          },
        }),
        complete: async (content, model) => {
          const artifact: AiArtifact = {
            id: aiArtifactId(`ai:${request.requestId}`),
            mailboxId: request.mailboxId,
            conversationId: request.conversationId,
            artifactType: 'reply_draft',
            sourceVersion: request.sourceVersion,
            model,
            policyVersion: REPLY_POLICY_VERSION,
            content,
            draftId: draft.id,
            draftVersion: draft.version,
            recipientFingerprint: fingerprint,
            createdAt: utcTimestamp(now().toISOString()),
          }
          await dependencies.store.saveAiArtifact(artifact)
          return artifact
        },
      })
    },
    async acceptAiReply(request) {
      const artifact = await dependencies.store.getAiArtifact({
        mailboxId: request.mailboxId,
        artifactId: request.artifactId,
      })
      if (
        !artifact?.draftId ||
        artifact.artifactType !== 'reply_draft' ||
        artifact.draftVersion !== request.expectedDraftVersion
      )
        throw new AiApplicationError('AI_ARTIFACT_STALE', 'AI reply is stale')
      const conversation = await dependencies.store.getConversation({
        requestId: request.requestId,
        mailboxId: request.mailboxId,
        conversationId: artifact.conversationId,
      })
      const draft = await dependencies.store.getDraft({
        mailboxId: request.mailboxId,
        draftId: artifact.draftId,
      })
      if (
        !conversation ||
        conversation.version !== artifact.sourceVersion ||
        !draft ||
        draft.version !== request.expectedDraftVersion ||
        recipientFingerprint(draft) !== artifact.recipientFingerprint
      )
        throw new AiApplicationError('AI_ARTIFACT_STALE', 'AI reply is stale')
      const saved = await dependencies.store.saveDraft({
        request: {
          requestId: request.requestId,
          mailboxId: request.mailboxId,
          draftId: draft.id,
          ...(draft.conversationId === undefined ? {} : { conversationId: draft.conversationId }),
          ...(draft.replyToMessageId === undefined
            ? {}
            : { replyToMessageId: draft.replyToMessageId }),
          expectedVersion: draft.version,
          idempotencyKey: request.idempotencyKey,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          textBody: artifact.content,
          ...(draft.htmlBody === undefined ? {} : { htmlBody: draft.htmlBody }),
        },
        id: draft.id,
        internetMessageId: `<${draft.id}@mailrovers.local>`,
        updatedAt: utcTimestamp(now().toISOString()),
      })
      await dependencies.store.reviewAiArtifact({
        mailboxId: request.mailboxId,
        artifactId: request.artifactId,
        decision: 'accepted',
        reviewedAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return saved
    },
    async reviewAiArtifact(request) {
      await dependencies.store.reviewAiArtifact({
        mailboxId: request.mailboxId,
        artifactId: request.artifactId,
        decision: request.decision,
        reviewedAt: utcTimestamp(now().toISOString()),
      })
    },
    async connectGmail(request) {
      const connector = required(dependencies.gmailConnector, 'Gmail connector')
      const sealer = required(dependencies.secretSealer, 'Secret sealer')
      const syncEngine = required(dependencies.syncEngine, 'Sync engine')
      if (connectionOperations.has(request.requestId))
        throw new Error('An operation with this request ID already exists')
      const controller = new AbortController()
      connectionOperations.set(request.requestId, controller)
      try {
        const authorization = await connector.authorize({
          ...(request.loginHint === undefined ? {} : { loginHint: request.loginHint }),
          signal: controller.signal,
        })
        const timestamp = utcTimestamp(now().toISOString())
        const id = mailboxId(`gmail:${authorization.providerAccountId}`)
        const mailbox: Mailbox = {
          id,
          workspaceId: workspaceId('workspace-personal'),
          provider: 'gmail',
          providerAccountId: authorization.providerAccountId,
          emailAddress: authorization.emailAddress,
          displayName: authorization.displayName,
          syncState: 'importing',
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const encryptedRefreshToken = await sealer.seal(authorization.refreshToken)
        await dependencies.store.saveConnectedMailbox({
          mailbox,
          encryptedRefreshToken,
          checkpoint: {
            mailboxId: id,
            historyStartCursor: authorization.historyId,
            importState: 'pending',
            importedMessageCount: 0,
            importedDraftCount: 0,
            updatedAt: timestamp,
          },
        })
        const sync = await syncEngine.start({ mailboxId: id, requestId: request.requestId })
        return {
          mailbox: {
            id,
            provider: 'gmail',
            emailAddress: authorization.emailAddress,
            displayName: authorization.displayName,
            syncState: 'importing',
            importedMessageCount: 0,
          },
          sync,
        }
      } finally {
        connectionOperations.delete(request.requestId)
      }
    },
    async disconnectMailbox(request) {
      connectionOperations.get(request.requestId)?.abort()
      await required(dependencies.syncEngine, 'Sync engine').cancelMailbox(request.mailboxId)
      await dependencies.store.removeMailbox({
        mailboxId: request.mailboxId,
        removeLocalData: request.removeLocalData,
      })
    },
    startSync(request) {
      return required(dependencies.syncEngine, 'Sync engine').start(request)
    },
    getSyncStatus(request) {
      return required(dependencies.syncEngine, 'Sync engine').getStatus(request.mailboxId)
    },
    async cancelOperation(request) {
      if (aiOperations.cancel(request.operationId)) return
      const validation = validationOperations.get(request.operationId)
      if (validation) {
        validation.abort()
        return
      }
      const connection = connectionOperations.get(request.operationId)
      if (connection) {
        connection.abort()
        return
      }
      await required(dependencies.syncEngine, 'Sync engine').cancel(request.operationId)
    },
    subscribeOperation(operationId) {
      return aiOperations.subscribe(operationId)
    },
  }
  return application
}
