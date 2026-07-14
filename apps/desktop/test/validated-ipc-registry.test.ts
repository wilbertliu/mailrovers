import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { channels } from '../electron/ipc/channels.js'
import { mailIpcRegistry } from '../electron/ipc/register-mail-application.js'
import { registerValidatedHandler, type IpcMainLike } from '../electron/ipc/validated-handler.js'
import { resultSchema } from '../electron/ipc/mailboxes.schema.js'

const inputSchema = z.object({ requestId: z.string(), value: z.number() }).strict()
const outputSchema = resultSchema(z.object({ doubled: z.number() }).strict())

function harness(run: (value: { requestId: string; value: number }) => Promise<unknown>) {
  let listener: ((event: never, input: unknown) => unknown) | undefined
  const removeHandler = vi.fn<IpcMainLike['removeHandler']>()
  const ipcMain: IpcMainLike = {
    handle: vi.fn<IpcMainLike['handle']>((_channel, next) => {
      listener = next as (event: never, input: unknown) => unknown
    }),
    removeHandler,
  }
  const mainFrame = { url: 'file:///MailRovers/index.html' }
  const webContents = { mainFrame }
  const unregister = registerValidatedHandler({
    ipcMain,
    definition: {
      channel: channels.listConversations,
      inputSchema,
      resultSchema: outputSchema,
      run: (_application, value) => run(value),
    },
    application: {},
    webContents,
    rendererUrl: mainFrame.url,
  })
  if (!listener) throw new Error('Handler was not installed')
  const authorizedEvent = { sender: webContents, senderFrame: mainFrame } as never
  return { listener, authorizedEvent, unregister, removeHandler, webContents }
}

describe('validated IPC handler', () => {
  it('returns stable envelopes for unauthorized, invalid, failed, invalid-output, and success cases', async () => {
    const success = harness(async ({ value }) => ({ doubled: value * 2 }))
    await expect(
      success.listener(
        { sender: { mainFrame: success.webContents.mainFrame }, senderFrame: null } as never,
        { requestId: 'unauthorized', value: 2 },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED_REQUEST' } })
    await expect(
      success.listener(success.authorizedEvent, { requestId: 'invalid', value: 'two' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    await expect(
      success.listener(success.authorizedEvent, { requestId: 'success', value: 2 }),
    ).resolves.toEqual({ ok: true, value: { doubled: 4 } })

    const failed = harness(async () => {
      throw Object.assign(new Error('provider leaked detail'), { code: 'AI_PROVIDER_UNAVAILABLE' })
    })
    await expect(
      failed.listener(failed.authorizedEvent, { requestId: 'failed', value: 2 }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'AI_PROVIDER_UNAVAILABLE',
        message: 'The AI provider could not complete the request.',
        retryable: true,
        requestId: 'failed',
        userAction: 'retry',
      },
    })

    const invalidOutput = harness(async () => ({ doubled: 'not-a-number', secret: 'do-not-leak' }))
    await expect(
      invalidOutput.listener(invalidOutput.authorizedEvent, {
        requestId: 'invalid-output',
        value: 2,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } })
  })

  it('unregisters predictably and rejects a result schema without a failure envelope', () => {
    const registered = harness(async () => ({ doubled: 2 }))
    registered.unregister()
    registered.unregister()
    // One pre-registration cleanup and one idempotent unregister.
    expect(registered.removeHandler).toHaveBeenCalledTimes(2)

    expect(() =>
      registerValidatedHandler({
        ipcMain: {
          handle: vi.fn<IpcMainLike['handle']>(),
          removeHandler: vi.fn<IpcMainLike['removeHandler']>(),
        },
        definition: {
          channel: 'invalid-schema',
          inputSchema,
          resultSchema: z.object({ ok: z.literal(true) }),
          run: async () => null,
        },
        application: {},
        webContents: { mainFrame: {} },
        rendererUrl: 'file:///MailRovers/index.html',
      }),
    ).toThrow('Invalid IPC result schema')
  })
})

describe('IPC registry coverage', () => {
  it('puts every invoke channel in the one validated registry exactly once', () => {
    const invokeChannels = Object.entries(channels)
      .filter(([name]) => name !== 'event')
      .map(([, channel]) => channel)
      .sort()
    const registeredChannels = mailIpcRegistry.map(({ channel }) => channel).sort()
    expect(new Set(registeredChannels).size).toBe(registeredChannels.length)
    expect(registeredChannels).toEqual(invokeChannels)
  })

  it.each(mailIpcRegistry.map(({ channel }) => [channel]))(
    '%s inherits authorization, safe input, failure, output, and success validation',
    (channel) => {
      const definition = mailIpcRegistry.find((entry) => entry.channel === channel)
      expect(definition).toMatchObject({ channel })
      expect(definition?.inputSchema).toMatchObject({ safeParse: expect.any(Function) })
      expect(definition?.resultSchema).toMatchObject({ safeParse: expect.any(Function) })
      expect(definition).toMatchObject({ run: expect.any(Function) })
    },
  )
})
