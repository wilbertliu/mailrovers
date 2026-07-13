import type { MailApplication } from '@mailrovers/mail-application'
import { ipcMain } from 'electron'
import { channels } from './channels.js'
import {
  conversationPageSchema,
  listConversationsInputSchema,
} from './list-conversations.schema.js'
import {
  isAllowedRendererUrl,
  isAuthorizedRequest,
  type AuthorizedWebContents,
} from './authorization.js'

export { isAllowedRendererUrl }
export const isAuthorizedListConversationsRequest = isAuthorizedRequest

export function registerListConversations(input: {
  application: MailApplication
  webContents: AuthorizedWebContents
  rendererUrl: string
}): void {
  ipcMain.handle(channels.listConversations, async (event, unknownInput) => {
    if (!isAuthorizedListConversationsRequest(event, input.webContents, input.rendererUrl))
      throw new Error('Unauthorized IPC request')
    const parsed = listConversationsInputSchema.safeParse(unknownInput)
    if (!parsed.success) throw new Error('Invalid inbox query')
    const page = await input.application.listConversations(parsed.data)
    const output = conversationPageSchema.safeParse(page)
    if (!output.success) throw new Error('Invalid inbox result')
    return output.data
  })
}
