/* oxlint-disable vitest/require-mock-type-parameters */
import { GMAIL_CAPABILITIES } from '@mailrovers/mail-contracts'
import { describe, expect, it, vi } from 'vitest'
import { channels } from '../electron/ipc/channels.js'
import { mailIpcRegistry } from '../electron/ipc/register-mail-application.js'

function workflow(channel: string) {
  const definition = mailIpcRegistry.find((entry) => entry.channel === channel)
  if (!definition) throw new Error(`Missing ${channel} handler`)
  return definition
}

describe('desktop mail workflows', () => {
  it.each(['cancelled', 'exported'] as const)(
    'returns a path-free attachment export %s envelope',
    async (status) => {
      const run = vi.fn(async () => ({ status, attachmentId: 'attachment-1' }))
      const definition = workflow(channels.exportAttachment)
      const value = await definition.run(
        { exportAttachment: run } as never,
        {
          requestId: 'export-request',
          mailboxId: 'gmail:desktop-workflow',
          messageId: 'message-1',
          attachmentId: 'attachment-1',
        } as never,
      )
      expect(definition.resultSchema.parse({ ok: true, value })).toEqual({ ok: true, value })
      expect(JSON.stringify(value)).not.toContain('path')
    },
  )

  it('keeps archive followed by Undo ordered at the desktop application boundary', async () => {
    const calls: string[] = []
    const executeCommand = vi.fn(async () => {
      calls.push('archive')
      return {
        id: 'archive-command',
        mailboxId: 'gmail:desktop-workflow',
        state: 'pending',
        command: { kind: 'set-thread-archived', conversationId: 'conversation-1', archived: true },
        createdAt: '2026-07-14T00:00:00.000Z',
      }
    })
    const undoCommand = vi.fn(async () => {
      calls.push('undo')
      return {
        id: 'undo-command',
        mailboxId: 'gmail:desktop-workflow',
        state: 'pending',
        command: { kind: 'set-thread-archived', conversationId: 'conversation-1', archived: false },
        createdAt: '2026-07-14T00:00:01.000Z',
      }
    })
    await workflow(channels.executeCommand).run(
      { executeCommand } as never,
      {
        requestId: 'archive-request',
        mailboxId: 'gmail:desktop-workflow',
        idempotencyKey: 'archive-command',
        command: { kind: 'set-thread-archived', conversationId: 'conversation-1', archived: true },
      } as never,
    )
    await workflow(channels.undoCommand).run(
      { undoCommand } as never,
      {
        requestId: 'undo-request',
        mailboxId: 'gmail:desktop-workflow',
        sourceCommandId: 'archive-command',
        idempotencyKey: 'undo-command',
      } as never,
    )
    expect(calls).toEqual(['archive', 'undo'])
    expect(undoCommand).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCommandId: 'archive-command' }),
    )
  })

  it('keeps a manual refresh backoff visible as a deferred receipt', async () => {
    const definition = workflow(channels.startSync)
    const input = definition.inputSchema.parse({
      requestId: 'refresh-request',
      mailboxId: 'gmail:desktop-workflow',
      reason: 'manual',
    })
    const value = await definition.run(
      {
        startSync: vi.fn(async () => ({
          requestId: 'refresh-request',
          mailboxId: 'gmail:desktop-workflow',
          state: 'deferred' as const,
          retryAt: '2026-07-14T00:05:00.000Z',
        })),
      } as never,
      input as never,
    )
    expect(definition.resultSchema.parse({ ok: true, value })).toEqual({ ok: true, value })
  })

  it('retains disconnect state, deletes only on request, and exposes reconnect capabilities', async () => {
    let retained = true
    const disconnectMailbox = vi.fn(async ({ removeLocalData }: { removeLocalData: boolean }) => {
      retained = !removeLocalData
    })
    const disconnect = workflow(channels.disconnectMailbox)
    await disconnect.run(
      { disconnectMailbox } as never,
      {
        requestId: 'disconnect',
        mailboxId: 'gmail:desktop-workflow',
        removeLocalData: false,
      } as never,
    )
    expect(retained).toBe(true)
    await disconnect.run(
      { disconnectMailbox } as never,
      { requestId: 'delete', mailboxId: 'gmail:desktop-workflow', removeLocalData: true } as never,
    )
    expect(retained).toBe(false)

    const connect = workflow(channels.connectGmail)
    const value = await connect.run(
      {
        connectGmail: vi.fn(async () => ({
          mailbox: {
            id: 'gmail:desktop-workflow',
            provider: 'gmail' as const,
            emailAddress: 'owner@example.test',
            displayName: 'Owner',
            syncState: 'importing' as const,
            connectionState: 'connected' as const,
            capabilities: GMAIL_CAPABILITIES,
            importedMessageCount: 0,
          },
          sync: {
            requestId: 'reconnect',
            mailboxId: 'gmail:desktop-workflow',
            state: 'active' as const,
          },
        })),
      } as never,
      { requestId: 'reconnect' } as never,
    )
    expect(definitionValue(value).mailbox.connectionState).toBe('connected')
    expect(definitionValue(value).mailbox.capabilities.attachmentExport).toBe(true)
  })
})

function definitionValue(value: unknown): {
  mailbox: { connectionState: string; capabilities: typeof GMAIL_CAPABILITIES }
} {
  return value as { mailbox: { connectionState: string; capabilities: typeof GMAIL_CAPABILITIES } }
}
