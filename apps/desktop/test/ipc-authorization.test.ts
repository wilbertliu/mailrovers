import { describe, expect, it } from 'vitest'
import {
  isAllowedRendererUrl,
  isAuthorizedListConversationsRequest,
} from '../electron/ipc/register-list-conversations.js'

describe('list-conversations authorization', () => {
  it('requires the bound webContents, main frame, and packaged URL', () => {
    const mainFrame = { url: 'file:///Applications/MailRovers/index.html' }
    const webContents = { mainFrame }
    expect(
      isAuthorizedListConversationsRequest(
        { sender: webContents, senderFrame: mainFrame },
        webContents,
        mainFrame.url,
      ),
    ).toBe(true)
    expect(
      isAuthorizedListConversationsRequest(
        { sender: { mainFrame }, senderFrame: mainFrame },
        webContents,
        mainFrame.url,
      ),
    ).toBe(false)
    expect(
      isAuthorizedListConversationsRequest(
        { sender: webContents, senderFrame: { url: mainFrame.url } },
        webContents,
        mainFrame.url,
      ),
    ).toBe(false)
    expect(
      isAuthorizedListConversationsRequest(
        { sender: webContents, senderFrame: { url: 'file:///tmp/evil.html' } },
        webContents,
        mainFrame.url,
      ),
    ).toBe(false)
  })

  it('allows only the configured development origin', () => {
    expect(isAllowedRendererUrl('http://localhost:5173/inbox', 'http://localhost:5173/')).toBe(true)
    expect(isAllowedRendererUrl('http://127.0.0.1:5173/', 'http://localhost:5173/')).toBe(false)
    expect(isAllowedRendererUrl('https://localhost:5173/', 'http://localhost:5173/')).toBe(false)
  })
})
