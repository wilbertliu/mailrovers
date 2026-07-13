import type {
  ConversationPageIpcOutput,
  ListConversationsIpcInput,
} from '../electron/ipc/list-conversations.schema.js'

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
  const MAIN_WINDOW_VITE_NAME: string
  interface Window {
    mailrovers: {
      v1: {
        listConversations(input: ListConversationsIpcInput): Promise<ConversationPageIpcOutput>
      }
    }
  }
}
export {}
