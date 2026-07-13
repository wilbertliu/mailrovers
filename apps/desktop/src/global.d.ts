import type {
  ConversationPageIpcOutput,
  ListConversationsIpcInput,
} from '../electron/ipc/list-conversations.schema.js'
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
