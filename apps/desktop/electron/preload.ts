import { contextBridge, ipcRenderer } from 'electron'; import { channels } from './ipc/channels.js'; import { listConversationsInputSchema, conversationPageSchema } from './ipc/list-conversations.schema.js';
const bridge = { v1: { async listConversations(input: unknown) { const parsed = listConversationsInputSchema.parse(input); const result: unknown = await ipcRenderer.invoke(channels.listConversations, parsed); return conversationPageSchema.parse(result); } } };
contextBridge.exposeInMainWorld('mailrovers', bridge);
