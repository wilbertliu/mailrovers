import type {
  ApplicationError,
  ConnectGmailResult,
  ConversationPage,
  DesktopEvent,
  IpcResult,
  ListConversationsInput,
  MailboxSummary,
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
}
