import type {
  ConversationPageIpcOutput,
  ListConversationsIpcInput,
} from '../electron/ipc/list-conversations.schema.js'
import type {
  CommandReceiptIpcResult,
  ExecuteCommandIpcInput,
  ListCommandIssuesIpcInput,
  ListCommandIssuesIpcResult,
  ResolveCommandIpcInput,
} from '../electron/ipc/commands.schema.js'
import type {
  DraftIpcResult,
  GetDraftIpcInput,
  GetDraftIpcResult,
  ListDraftsIpcInput,
  ListDraftsIpcResult,
  SaveDraftIpcInput,
  SendDraftIpcInput,
  SendDraftIpcResult,
} from '../electron/ipc/drafts.schema.js'
import type {
  GetConversationIpcInput,
  GetConversationIpcResult,
  ListLabelsIpcInput,
  ListLabelsIpcResult,
  SearchMailIpcInput,
  SearchMailIpcResult,
} from '../electron/ipc/mail.schema.js'
import type {
  CancelOperationIpcInput,
  ConnectGmailIpcInput,
  ConnectGmailIpcResult,
  DesktopIpcEvent,
  DisconnectMailboxIpcInput,
  GetSyncStatusIpcInput,
  ListMailboxesIpcInput,
  ListMailboxesIpcResult,
  StartSyncIpcInput,
  SyncReceiptIpcResult,
  SyncStatusIpcResult,
  VoidIpcResult,
} from '../electron/ipc/mailboxes.schema.js'

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
  const MAIN_WINDOW_VITE_NAME: string
  interface Window {
    mailrovers: {
      v1: {
        listConversations(input: ListConversationsIpcInput): Promise<ConversationPageIpcOutput>
        listMailboxes(input: ListMailboxesIpcInput): Promise<ListMailboxesIpcResult>
        listLabels(input: ListLabelsIpcInput): Promise<ListLabelsIpcResult>
        getConversation(input: GetConversationIpcInput): Promise<GetConversationIpcResult>
        searchMail(input: SearchMailIpcInput): Promise<SearchMailIpcResult>
        executeCommand(input: ExecuteCommandIpcInput): Promise<CommandReceiptIpcResult>
        listCommandIssues(input: ListCommandIssuesIpcInput): Promise<ListCommandIssuesIpcResult>
        resolveCommand(input: ResolveCommandIpcInput): Promise<VoidIpcResult>
        saveDraft(input: SaveDraftIpcInput): Promise<DraftIpcResult>
        getDraft(input: GetDraftIpcInput): Promise<GetDraftIpcResult>
        listDrafts(input: ListDraftsIpcInput): Promise<ListDraftsIpcResult>
        sendDraft(input: SendDraftIpcInput): Promise<SendDraftIpcResult>
        connectGmail(input: ConnectGmailIpcInput): Promise<ConnectGmailIpcResult>
        disconnectMailbox(input: DisconnectMailboxIpcInput): Promise<VoidIpcResult>
        startSync(input: StartSyncIpcInput): Promise<SyncReceiptIpcResult>
        getSyncStatus(input: GetSyncStatusIpcInput): Promise<SyncStatusIpcResult>
        cancelOperation(input: CancelOperationIpcInput): Promise<VoidIpcResult>
        subscribe(requestId: string, callback: (event: DesktopIpcEvent) => void): () => void
      }
    }
  }
}
export {}
