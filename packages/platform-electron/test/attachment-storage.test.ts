import {
  createMailApplication,
  type CommandDispatcher,
  type MailStore,
  type SyncEngine,
} from '@mailrovers/mail-application'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ElectronAttachmentStorage } from '../src/attachment-storage.js'

describe('ElectronAttachmentStorage', () => {
  it('removes mailbox cache files when disconnect wipes local data', async () => {
    const applicationDataRoot = mkdtempSync(join(tmpdir(), 'mailrovers-attachments-'))
    try {
      const storage = new ElectronAttachmentStorage({ applicationDataRoot })
      const cached = await storage.cache({
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
            controller.close()
          },
        }),
        expectedSizeBytes: 3,
        signal: new AbortController().signal,
      })
      const cachedFile = join(applicationDataRoot, cached.relativePath)
      expect(existsSync(cachedFile)).toBe(true)

      const removeMailbox = vi.fn<() => Promise<void>>(async () => undefined)
      const application = createMailApplication({
        store: {
          cancelMailboxCommands: vi.fn<() => Promise<void>>(async () => undefined),
          listAttachmentCachePaths: vi.fn<() => Promise<string[]>>(async () => [
            cached.relativePath,
          ]),
          removeMailbox,
        } as unknown as MailStore,
        attachmentStorage: storage,
        syncEngine: {
          cancelMailbox: vi.fn<() => Promise<boolean>>(async () => true),
        } as unknown as SyncEngine,
        commandDispatcher: {
          cancelMailbox: vi.fn<() => Promise<boolean>>(async () => true),
        } as unknown as CommandDispatcher,
      })

      await application.disconnectMailbox({
        requestId: 'disconnect-1' as never,
        mailboxId: 'gmail:attachment-test' as never,
        removeLocalData: true,
      })

      expect(existsSync(cachedFile)).toBe(false)
      expect(removeMailbox).toHaveBeenCalledWith({
        mailboxId: 'gmail:attachment-test',
        removeLocalData: true,
      })
    } finally {
      rmSync(applicationDataRoot, { recursive: true, force: true })
    }
  })
})
