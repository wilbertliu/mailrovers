import type { MailApplication } from '@mailrovers/mail-application';
import { ipcMain } from 'electron';
import { channels } from './channels.js';
import { conversationPageSchema, listConversationsInputSchema } from './list-conversations.schema.js';

type AuthorizedWebContents = { mainFrame: unknown };
type AuthorizationEvent = { sender: AuthorizedWebContents; senderFrame: { url: string } | null };

export function isAllowedRendererUrl(actualUrl: string, expectedRendererUrl: string): boolean {
  try {
    const actual = new URL(actualUrl);
    const expected = new URL(expectedRendererUrl);
    return expected.protocol === 'file:' ? actual.href === expected.href : actual.origin === expected.origin;
  } catch {
    return false;
  }
}

export function isAuthorizedListConversationsRequest(event: AuthorizationEvent, expectedWebContents: AuthorizedWebContents, expectedRendererUrl: string): boolean {
  return event.sender === expectedWebContents
    && event.senderFrame !== null
    && event.senderFrame === event.sender.mainFrame
    && isAllowedRendererUrl(event.senderFrame.url, expectedRendererUrl);
}

export function registerListConversations(input: { application: MailApplication; webContents: AuthorizedWebContents; rendererUrl: string }): void {
  ipcMain.handle(channels.listConversations, async (event, unknownInput) => {
    if (!isAuthorizedListConversationsRequest(event, input.webContents, input.rendererUrl)) throw new Error('Unauthorized IPC request');
    const parsed = listConversationsInputSchema.safeParse(unknownInput);
    if (!parsed.success) throw new Error('Invalid inbox query');
    const page = await input.application.listConversations(parsed.data);
    const output = conversationPageSchema.safeParse(page);
    if (!output.success) throw new Error('Invalid inbox result');
    return output.data;
  });
}
