import type { ConversationPage, ListConversationsInput } from '@mailrovers/mail-contracts'
import type { MailStore } from './mail-store.js'
export interface MailApplication {
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
}
export function createMailApplication(store: MailStore): MailApplication {
  return { listConversations: (input) => store.listConversations(input) }
}
