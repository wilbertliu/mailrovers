import type {
  AiArtifact,
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
  IpcResult,
  LabelSummary,
  ListConversationsInput,
  MailCommand,
  MailboxSummary,
  SaveAiConfigurationInput,
  SaveDraftInput,
  SearchMailInput,
  SearchPage,
  SendDraftReceipt,
  SyncReceipt,
  SyncStatus,
} from '@mailrovers/mail-contracts'
import { operationId, type MailboxId, type OperationId } from '@mailrovers/mail-domain'

export class DesktopApplicationError extends Error {
  constructor(readonly detail: ApplicationError) {
    super(detail.message)
    this.name = 'DesktopApplicationError'
  }
}

function unwrap<Value>(result: IpcResult<Value>): Value {
  if (!result.ok) throw new DesktopApplicationError(result.error)
  return result.value
}

export const desktopBridge = {
  createRequestId(): OperationId {
    return operationId(crypto.randomUUID())
  },
  listConversations: (input: ListConversationsInput): Promise<ConversationPage> =>
    window.mailrovers.v1.listConversations(input),
  async listLabels(mailboxId: MailboxId): Promise<LabelSummary[]> {
    return unwrap(
      await window.mailrovers.v1.listLabels({
        requestId: this.createRequestId(),
        mailboxId,
      }),
    )
  },
  async getConversation(input: {
    mailboxId: MailboxId
    conversationId: ConversationDetail['id']
  }): Promise<ConversationDetail | undefined> {
    const result = unwrap(
      await window.mailrovers.v1.getConversation({
        requestId: this.createRequestId(),
        ...input,
      }),
    )
    return result ?? undefined
  },
  async searchMail(input: Omit<SearchMailInput, 'requestId'>): Promise<SearchPage> {
    return unwrap(
      await window.mailrovers.v1.searchMail({ requestId: this.createRequestId(), ...input }),
    )
  },
  async executeCommand(input: {
    mailboxId: MailboxId
    idempotencyKey: string
    command: MailCommand
  }): Promise<CommandReceipt> {
    return unwrap(
      await window.mailrovers.v1.executeCommand({
        requestId: this.createRequestId(),
        ...input,
      }),
    )
  },
  async listCommandIssues(mailboxId: MailboxId): Promise<CommandReceipt[]> {
    return unwrap(
      await window.mailrovers.v1.listCommandIssues({
        requestId: this.createRequestId(),
        mailboxId,
      }),
    )
  },
  async resolveCommand(input: {
    mailboxId: MailboxId
    commandId: CommandReceipt['id']
    resolution: 'recheck' | 'retry' | 'cancel'
  }): Promise<void> {
    unwrap(
      await window.mailrovers.v1.resolveCommand({
        requestId: this.createRequestId(),
        ...input,
      }),
    )
  },
  async saveDraft(input: Omit<SaveDraftInput, 'requestId'>): Promise<Draft> {
    return unwrap(
      await window.mailrovers.v1.saveDraft({ requestId: this.createRequestId(), ...input }),
    )
  },
  async listDrafts(mailboxId: MailboxId): Promise<Draft[]> {
    return unwrap(
      await window.mailrovers.v1.listDrafts({
        requestId: this.createRequestId(),
        mailboxId,
      }),
    )
  },
  async sendDraft(input: {
    mailboxId: MailboxId
    draftId: Draft['id']
    expectedVersion: number
    idempotencyKey: string
  }): Promise<SendDraftReceipt> {
    return unwrap(
      await window.mailrovers.v1.sendDraft({ requestId: this.createRequestId(), ...input }),
    )
  },
  async getAiConfiguration(mailboxId: MailboxId): Promise<AiConfigurationStatus> {
    return unwrap(
      await window.mailrovers.v1.getAiConfiguration({
        requestId: this.createRequestId(),
        mailboxId,
      }),
    )
  },
  async saveAiConfiguration(
    input: Omit<SaveAiConfigurationInput, 'requestId'>,
  ): Promise<AiConfigurationStatus> {
    return unwrap(
      await window.mailrovers.v1.saveAiConfiguration({
        requestId: this.createRequestId(),
        ...input,
      }),
    )
  },
  async clearAiConfiguration(mailboxId: MailboxId): Promise<void> {
    unwrap(
      await window.mailrovers.v1.clearAiConfiguration({
        requestId: this.createRequestId(),
        mailboxId,
      }),
    )
  },
  async validateAiConfiguration(mailboxId: MailboxId): Promise<AiConfigurationStatus> {
    return unwrap(
      await window.mailrovers.v1.validateAiConfiguration({
        requestId: this.createRequestId(),
        mailboxId,
      }),
    )
  },
  async startConversationSummary(input: {
    mailboxId: MailboxId
    conversationId: ConversationDetail['id']
    sourceVersion: number
    force?: boolean | undefined
    userInstructions?: string | undefined
  }): Promise<AiStreamReceipt> {
    return unwrap(
      await window.mailrovers.v1.startConversationSummary({
        requestId: this.createRequestId(),
        ...input,
      }),
    )
  },
  async startReplyDraft(input: {
    mailboxId: MailboxId
    conversationId: ConversationDetail['id']
    sourceVersion: number
    draftId: Draft['id']
    draftVersion: number
    userInstructions?: string | undefined
  }): Promise<AiStreamReceipt> {
    return unwrap(
      await window.mailrovers.v1.startReplyDraft({
        requestId: this.createRequestId(),
        ...input,
      }),
    )
  },
  async acceptAiReply(input: {
    mailboxId: MailboxId
    artifactId: AiArtifact['id']
    expectedDraftVersion: number
    idempotencyKey: string
  }): Promise<Draft> {
    return unwrap(
      await window.mailrovers.v1.acceptAiReply({
        requestId: this.createRequestId(),
        ...input,
      }),
    )
  },
  async rejectAiArtifact(input: {
    mailboxId: MailboxId
    artifactId: AiArtifact['id']
  }): Promise<void> {
    unwrap(
      await window.mailrovers.v1.reviewAiArtifact({
        requestId: this.createRequestId(),
        decision: 'rejected',
        ...input,
      }),
    )
  },
  async listMailboxes(requestId: OperationId): Promise<MailboxSummary[]> {
    return unwrap(await window.mailrovers.v1.listMailboxes({ requestId }))
  },
  async connectGmail(input: {
    requestId: OperationId
    loginHint?: string | undefined
  }): Promise<ConnectGmailResult> {
    return unwrap(await window.mailrovers.v1.connectGmail(input))
  },
  async disconnectMailbox(input: {
    requestId: OperationId
    mailboxId: MailboxId
    removeLocalData: boolean
  }): Promise<void> {
    unwrap(await window.mailrovers.v1.disconnectMailbox(input))
  },
  async startSync(input: { requestId: OperationId; mailboxId: MailboxId }): Promise<SyncReceipt> {
    return unwrap(await window.mailrovers.v1.startSync(input))
  },
  async getSyncStatus(input: {
    requestId: OperationId
    mailboxId: MailboxId
  }): Promise<SyncStatus> {
    return unwrap(await window.mailrovers.v1.getSyncStatus(input))
  },
  async cancelOperation(input: {
    requestId: OperationId
    operationId: OperationId
  }): Promise<void> {
    unwrap(await window.mailrovers.v1.cancelOperation(input))
  },
  subscribe(requestId: OperationId, callback: (event: DesktopEvent) => void): () => void {
    return window.mailrovers.v1.subscribe(requestId, callback)
  },
  subscribeOperation(
    requestId: OperationId,
    mailboxId: MailboxId,
    callback: (event: AiStreamEvent) => void,
  ): () => void {
    return window.mailrovers.v1.subscribeOperation(requestId, mailboxId, (event) => {
      switch (event.kind) {
        case 'ai-started':
        case 'ai-delta':
        case 'ai-completed':
        case 'ai-failed':
        case 'ai-cancelled':
          callback(event)
          break
      }
    })
  },
}
