import type { OperationId } from '@mailrovers/mail-domain'
import type {
  AcceptAiReplyInput,
  AiConfigurationStatus,
  AiStreamReceipt,
  ClearAiConfigurationInput,
  DraftReplyInput,
  GetAiConfigurationInput,
  ReviewAiArtifactInput,
  SaveAiConfigurationInput,
  SummarizeConversationInput,
  ValidateAiConfigurationInput,
} from './ai.js'
import type {
  CommandReceipt,
  ExecuteMailCommandInput,
  ListCommandIssuesInput,
  ResolveCommandInput,
  UndoMailCommandInput,
} from './commands.js'
import type { ConversationPage, ListConversationsInput } from './conversations.js'
import type {
  Draft,
  GetDraftInput,
  ListDraftsInput,
  SaveDraftInput,
  SendDraftInput,
  SendDraftReceipt,
} from './drafts.js'
import type {
  DesktopEvent,
  IpcResult,
  ConnectGmailInput,
  ConnectGmailResult,
  DisconnectMailboxInput,
  GetSyncStatusInput,
  ListMailboxesInput,
  MailboxSummary,
  StartSyncInput,
  SyncReceipt,
  SyncStatus,
} from './mailboxes.js'
import type {
  ConversationDetail,
  ExportAttachmentInput,
  ExportAttachmentResult,
  GetConversationInput,
  GetMessageBodyInput,
  LabelSummary,
  ListLabelsInput,
  MessageBody,
  SearchMailInput,
  SearchPage,
} from './mail.js'

export type DesktopBridgeV1 = {
  listConversations(input: ListConversationsInput): Promise<IpcResult<ConversationPage>>
  listMailboxes(input: ListMailboxesInput): Promise<IpcResult<MailboxSummary[]>>
  listLabels(input: ListLabelsInput): Promise<IpcResult<LabelSummary[]>>
  getConversation(input: GetConversationInput): Promise<IpcResult<ConversationDetail | null>>
  getMessageBody(input: GetMessageBodyInput): Promise<IpcResult<MessageBody | null>>
  exportAttachment(input: ExportAttachmentInput): Promise<IpcResult<ExportAttachmentResult>>
  searchMail(input: SearchMailInput): Promise<IpcResult<SearchPage>>
  executeCommand(input: ExecuteMailCommandInput): Promise<IpcResult<CommandReceipt>>
  undoCommand(input: UndoMailCommandInput): Promise<IpcResult<CommandReceipt>>
  listCommandIssues(input: ListCommandIssuesInput): Promise<IpcResult<CommandReceipt[]>>
  resolveCommand(input: ResolveCommandInput): Promise<IpcResult<null>>
  saveDraft(input: SaveDraftInput): Promise<IpcResult<Draft>>
  getDraft(input: GetDraftInput): Promise<IpcResult<Draft | null>>
  listDrafts(input: ListDraftsInput): Promise<IpcResult<Draft[]>>
  sendDraft(input: SendDraftInput): Promise<IpcResult<SendDraftReceipt>>
  getAiConfiguration(input: GetAiConfigurationInput): Promise<IpcResult<AiConfigurationStatus>>
  saveAiConfiguration(input: SaveAiConfigurationInput): Promise<IpcResult<AiConfigurationStatus>>
  clearAiConfiguration(input: ClearAiConfigurationInput): Promise<IpcResult<null>>
  validateAiConfiguration(
    input: ValidateAiConfigurationInput,
  ): Promise<IpcResult<AiConfigurationStatus>>
  startConversationSummary(input: SummarizeConversationInput): Promise<IpcResult<AiStreamReceipt>>
  startReplyDraft(input: DraftReplyInput): Promise<IpcResult<AiStreamReceipt>>
  acceptAiReply(input: AcceptAiReplyInput): Promise<IpcResult<Draft>>
  reviewAiArtifact(input: ReviewAiArtifactInput): Promise<IpcResult<null>>
  connectGmail(input: ConnectGmailInput): Promise<IpcResult<ConnectGmailResult>>
  disconnectMailbox(input: DisconnectMailboxInput): Promise<IpcResult<null>>
  startSync(input: StartSyncInput): Promise<IpcResult<SyncReceipt>>
  getSyncStatus(input: GetSyncStatusInput): Promise<IpcResult<SyncStatus>>
  cancelOperation(input: {
    requestId: OperationId
    operationId: OperationId
  }): Promise<IpcResult<null>>
  subscribe(requestId: string, callback: (event: DesktopEvent) => void): () => void
  subscribeOperation(
    requestId: string,
    mailboxId: string,
    callback: (event: DesktopEvent) => void,
  ): () => void
}

export type DesktopBridge = { v1: DesktopBridgeV1 }
