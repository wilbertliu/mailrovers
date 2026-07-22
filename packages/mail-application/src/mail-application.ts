import { GMAIL_CAPABILITIES } from '@mailrovers/mail-contracts'
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
  ExportAttachmentInput,
  ExportAttachmentResult,
  GetAiConfigurationInput,
  GetConversationInput,
  GetDraftInput,
  GetMessageBodyInput,
  GetSyncStatusInput,
  ListCommandIssuesInput,
  ListConversationsInput,
  ListDraftsInput,
  ListLabelsInput,
  ListMailboxesInput,
  LabelSummary,
  MailboxSummary,
  MessageBody,
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
  UndoMailCommandInput,
  ValidateAiConfigurationInput,
} from '@mailrovers/mail-contracts'
import {
  aiArtifactId,
  mailboxId,
  newCommandId,
  newDraftId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type MailboxId,
  type ConversationId,
  type OperationId,
} from '@mailrovers/mail-domain'
import { MAX_CONTEXT_BYTES, recipientFingerprint, selectAiContext } from './ai-context.js'
import { AiApplicationError, AiOperationRegistry } from './ai-operations.js'
import {
  REPLY_POLICY_VERSION,
  SUMMARY_POLICY_VERSION,
  type AiProviderConfiguration,
  type AiRuntimeFactory,
} from './ai-runtime.js'
import type { AttachmentStorage, GmailConnector, MailProviderFactory } from './mail-provider.js'
import { ISSUE_STATES, type MailStore, type StoredAiConfiguration } from './mail-store.js'
import type { CommandDispatcher, SecretSealer, SyncEngine } from './sync-engine.js'

export interface MailApplication {
  listMailboxes(input: ListMailboxesInput): Promise<MailboxSummary[]>
  connectGmail(input: ConnectGmailInput): Promise<ConnectGmailResult>
  disconnectMailbox(input: DisconnectMailboxInput): Promise<void>
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  listLabels(input: ListLabelsInput): Promise<LabelSummary[]>
  getConversation(input: GetConversationInput): Promise<ConversationDetail | undefined>
  getMessageBody(input: GetMessageBodyInput): Promise<MessageBody | undefined>
  exportAttachment(input: ExportAttachmentInput): Promise<ExportAttachmentResult>
  searchMail(input: SearchMailInput): Promise<SearchPage>
  executeCommand(input: ExecuteMailCommandInput): Promise<CommandReceipt>
  undoCommand(input: UndoMailCommandInput): Promise<CommandReceipt>
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
  providers?: MailProviderFactory | undefined
  attachmentStorage?: AttachmentStorage | undefined
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
  const attachmentOperations = new Map<OperationId, AbortController>()
  const aiOperations = new AiOperationRegistry(dependencies.publishAiEvent ?? (() => {}))

  const requireConnectedMailbox = async (id: MailboxId): Promise<void> => {
    const mailbox = await dependencies.store.getMailbox(id)
    if (mailbox === undefined) throw new Error('Mailbox was not found')
    if (mailbox.connectionState === 'disconnected')
      throw new Error('Mailbox is disconnected and cannot contact Gmail')
  }

  const loadAiConfiguration = async (id: MailboxId): Promise<StoredAiConfiguration> => {
    const configuration = await dependencies.store.getAiConfiguration(id)
    if (!configuration?.encryptedApiKey)
      throw new AiApplicationError('AI_CONFIGURATION_INVALID', 'AI is not configured')
    return configuration
  }

  const loadAiContext = async (
    mailboxId: MailboxId,
    conversationId: ConversationId,
    expectedVersion: number,
    artifactType: 'conversation_summary' | 'reply_draft',
  ) => {
    const snapshot = await dependencies.store.loadAiSourceSnapshot({
      mailboxId,
      conversationId,
      expectedVersion,
      artifactType,
      maxBodyBytes: MAX_CONTEXT_BYTES,
    })
    if (!snapshot)
      throw new AiApplicationError('AI_CONTEXT_STALE', 'Conversation changed before generation')
    const context = selectAiContext(snapshot.conversation, snapshot.bodies, artifactType)
    return {
      conversation: snapshot.conversation,
      ...context,
      truncated: context.truncated || snapshot.truncated,
    }
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

  const startAiArtifact = async (input: {
    requestId: SummarizeConversationInput['requestId']
    mailboxId: MailboxId
    conversationId: ConversationId
    sourceVersion: number
    artifactType: 'conversation_summary' | 'reply_draft'
    policyVersion: string
    force?: boolean | undefined
    userInstructions?: string | undefined
    cache?: boolean | undefined
    draftGate?:
      | (() => Promise<{
          id: Draft['id']
          version: number
          recipients: Draft['to']
          subject: string
          textBody: string
          recipientFingerprint: string
        }>)
      | undefined
  }): Promise<AiStreamReceipt> => {
    const context = await loadAiContext(
      input.mailboxId,
      input.conversationId,
      input.sourceVersion,
      input.artifactType,
    )
    const draft = input.draftGate === undefined ? undefined : await input.draftGate()
    const configuration = await loadAiConfiguration(input.mailboxId)
    const receipt: AiStreamReceipt = {
      requestId: input.requestId,
      mailboxId: input.mailboxId,
      conversationId: input.conversationId,
      artifactType: input.artifactType,
      sourceVersion: input.sourceVersion,
    }
    if (input.cache && !input.force) {
      const cached = await dependencies.store.findAiArtifact({
        mailboxId: input.mailboxId,
        conversationId: input.conversationId,
        artifactType: input.artifactType,
        sourceVersion: input.sourceVersion,
        model: configuration.model,
        policyVersion: input.policyVersion,
      })
      if (cached) return aiOperations.registerCached(receipt, cached)
    }
    return aiOperations.registerRuntime({
      receipt,
      prepare: async () => ({
        runtime: required(dependencies.aiRuntimeFactory, 'AI runtime').create(
          await resolveRuntimeConfiguration(configuration),
        ),
        request: {
          requestId: input.requestId,
          mailboxId: input.mailboxId,
          conversationId: input.conversationId,
          artifactType: input.artifactType,
          sourceVersion: input.sourceVersion,
          policyVersion: input.policyVersion,
          messages: context.messages,
          contextTruncated: context.truncated,
          ...(draft === undefined
            ? {}
            : {
                draft: {
                  id: draft.id,
                  version: draft.version,
                  recipients: draft.recipients,
                  subject: draft.subject,
                  textBody: draft.textBody,
                },
              }),
          ...(input.userInstructions === undefined
            ? {}
            : { userInstructions: input.userInstructions }),
        },
      }),
      complete: async (content, model) => {
        const artifact: AiArtifact = {
          id: aiArtifactId(`ai:${input.requestId}`),
          mailboxId: input.mailboxId,
          conversationId: input.conversationId,
          artifactType: input.artifactType,
          sourceVersion: input.sourceVersion,
          model,
          policyVersion: input.policyVersion,
          content,
          ...(draft === undefined
            ? {}
            : {
                draftId: draft.id,
                draftVersion: draft.version,
                recipientFingerprint: draft.recipientFingerprint,
              }),
          createdAt: utcTimestamp(now().toISOString()),
        }
        if (!(await dependencies.store.saveAiArtifactIfCurrent(artifact)))
          throw new AiApplicationError('AI_CONTEXT_STALE', 'Conversation changed during generation')
        return artifact
      },
    })
  }

  const application: MailApplication & MailApplicationOperations = {
    listMailboxes: () => dependencies.store.listMailboxes(),
    listConversations: (request) => dependencies.store.listConversations(request),
    listLabels: (request) => dependencies.store.listLabels(request.mailboxId),
    getConversation: (request) => dependencies.store.getConversation(request),
    getMessageBody: (request) => dependencies.store.getMessageBody(request),
    async exportAttachment(request) {
      await requireConnectedMailbox(request.mailboxId)
      if (attachmentOperations.has(request.requestId))
        throw new Error('An operation with this request ID already exists')
      const attachment = await dependencies.store.getAttachmentForExport(request)
      if (attachment === undefined) throw new Error('Attachment was not found for this mailbox')
      const controller = new AbortController()
      attachmentOperations.set(request.requestId, controller)
      try {
        let relativePath = attachment.cachedRelativePath
        const storage = required(dependencies.attachmentStorage, 'Attachment storage')
        if (relativePath !== undefined && !(await storage.exists(relativePath)))
          relativePath = undefined
        if (relativePath === undefined) {
          const provider = await required(dependencies.providers, 'Mail provider').create(
            request.mailboxId,
          )
          if (!provider.getCapabilities().attachmentExport)
            throw new Error('This provider does not support attachment export')
          const stream = await provider.getAttachment({
            mailboxId: request.mailboxId,
            providerMessageId: attachment.providerMessageId,
            providerAttachmentId: attachment.providerAttachmentId,
            expectedSizeBytes: attachment.sizeBytes,
            signal: controller.signal,
          })
          const cached = await storage.cache({
            stream,
            expectedSizeBytes: attachment.sizeBytes,
            signal: controller.signal,
          })
          relativePath = cached.relativePath
          await dependencies.store.markAttachmentCached({
            mailboxId: request.mailboxId,
            messageId: request.messageId,
            attachmentId: request.attachmentId,
            relativePath,
          })
        }
        const status = await storage.export({
          relativePath,
          suggestedName: attachment.filename,
          signal: controller.signal,
        })
        return { status, attachmentId: request.attachmentId }
      } finally {
        attachmentOperations.delete(request.requestId)
      }
    },
    searchMail: (request) => dependencies.store.searchMail(request),
    async executeCommand(request) {
      await requireConnectedMailbox(request.mailboxId)
      const receipt = await dependencies.store.enqueueCommand({
        id: newCommandId(),
        mailboxId: request.mailboxId,
        idempotencyKey: request.idempotencyKey,
        command: request.command,
        createdAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return receipt
    },
    async undoCommand(request) {
      await requireConnectedMailbox(request.mailboxId)
      const receipt = await dependencies.store.enqueueInverseCommand({
        id: newCommandId(),
        mailboxId: request.mailboxId,
        sourceCommandId: request.sourceCommandId,
        idempotencyKey: request.idempotencyKey,
        createdAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return receipt
    },
    listCommandIssues: (request) => dependencies.store.listCommandIssues(request.mailboxId),
    async resolveCommand(request) {
      await dependencies.store.setCommandState({
        id: request.commandId,
        mailboxId: request.mailboxId,
        state: request.resolution === 'cancel' ? 'cancelled' : 'pending',
        updatedAt: utcTimestamp(now().toISOString()),
        allowedSourceStates: ISSUE_STATES,
      })
      if (request.resolution !== 'cancel') dependencies.commandDispatcher?.wake()
    },
    async saveDraft(request) {
      const id = request.draftId ?? newDraftId()
      const saved = await dependencies.store.saveDraft({
        request,
        id,
        internetMessageId: `<${id}@mailrovers.local>`,
        updatedAt: utcTimestamp(now().toISOString()),
      })
      dependencies.commandDispatcher?.wake()
      return saved
    },
    getDraft: (request) =>
      dependencies.store.getDraft({ mailboxId: request.mailboxId, draftId: request.draftId }),
    listDrafts: (request) => dependencies.store.listDrafts(request.mailboxId),
    async sendDraft(request) {
      await requireConnectedMailbox(request.mailboxId)
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
      return startAiArtifact({
        requestId: request.requestId,
        mailboxId: request.mailboxId,
        conversationId: request.conversationId,
        sourceVersion: request.sourceVersion,
        artifactType: 'conversation_summary',
        policyVersion: SUMMARY_POLICY_VERSION,
        force: request.force,
        userInstructions: request.userInstructions,
        cache: true,
      })
    },
    async startReplyDraft(request) {
      return startAiArtifact({
        requestId: request.requestId,
        mailboxId: request.mailboxId,
        conversationId: request.conversationId,
        sourceVersion: request.sourceVersion,
        artifactType: 'reply_draft',
        policyVersion: REPLY_POLICY_VERSION,
        userInstructions: request.userInstructions,
        draftGate: async () => {
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
          return {
            id: draft.id,
            version: draft.version,
            recipients: [...draft.to, ...draft.cc, ...draft.bcc],
            subject: draft.subject,
            textBody: draft.textBody,
            recipientFingerprint: recipientFingerprint(draft),
          }
        },
      })
    },
    async acceptAiReply(request) {
      const saved = await dependencies.store.acceptAiReply({
        mailboxId: request.mailboxId,
        artifactId: request.artifactId,
        expectedDraftVersion: request.expectedDraftVersion,
        idempotencyKey: request.idempotencyKey,
        updatedAt: utcTimestamp(now().toISOString()),
      })
      if (saved === undefined)
        throw new AiApplicationError('AI_ARTIFACT_STALE', 'AI reply is stale')
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
          connectionState: 'connected',
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
        const sync = await syncEngine.start({
          mailboxId: id,
          requestId: request.requestId,
          reason: 'lifecycle',
        })
        return {
          mailbox: {
            id,
            provider: 'gmail',
            emailAddress: authorization.emailAddress,
            displayName: authorization.displayName,
            syncState: 'importing',
            connectionState: 'connected',
            capabilities: GMAIL_CAPABILITIES,
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
      // Provider work must be quiescent before credentials or local data can disappear.
      await required(dependencies.commandDispatcher, 'Command dispatcher').cancelMailbox(
        request.mailboxId,
      )
      await dependencies.store.cancelMailboxCommands({
        mailboxId: request.mailboxId,
        updatedAt: utcTimestamp(now().toISOString()),
      })
      if (request.removeLocalData) {
        const attachmentPaths = await dependencies.store.listAttachmentCachePaths(request.mailboxId)
        if (attachmentPaths.length > 0)
          await required(dependencies.attachmentStorage, 'Attachment storage').remove(
            attachmentPaths,
          )
      }
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
      const attachment = attachmentOperations.get(request.operationId)
      if (attachment) {
        attachment.abort()
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
