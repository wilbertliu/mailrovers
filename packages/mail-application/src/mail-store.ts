import type { ConversationPage, ListConversationsInput } from '@mailrovers/mail-contracts';
export interface MailStore { listConversations(input: ListConversationsInput): Promise<ConversationPage>; }
