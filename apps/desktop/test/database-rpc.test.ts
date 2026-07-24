import type { MailStore } from '@mailrovers/mail-application'
import { mailboxId } from '@mailrovers/mail-domain'
import { databaseRpcFixtures } from './fixtures/database-rpc-fixtures.js'
import { describe, expect, it, vi } from 'vitest'
import {
  databaseOperations,
  dispatchDatabaseOperation,
  parseDatabaseRequest,
  parseDatabaseWorkerMessage,
  reconstructDatabaseError,
  serializeDatabaseError,
  workerCloseFailureMessage,
  workerOperationFailureMessage,
  type DatabaseOperationRegistry,
} from '../electron/database/database-rpc.js'

describe('database RPC envelopes', () => {
  it('accepts only positive safe request ids and registered methods', () => {
    expect(() => parseDatabaseRequest({ id: 0, method: 'listMailboxes' })).toThrow(/./)
    expect(() => parseDatabaseRequest({ id: 1.5, method: 'listMailboxes' })).toThrow(/./)
    expect(() =>
      parseDatabaseRequest({ id: Number.MAX_SAFE_INTEGER + 1, method: 'listMailboxes' }),
    ).toThrow(/./)
    expect(() => parseDatabaseRequest({ id: 1, method: 'missing' })).toThrow(/./)
    expect(() => parseDatabaseRequest({ id: 1, method: 'listMailboxes', extra: true })).toThrow(/./)
  })

  it('enforces method-specific input envelope shapes', () => {
    expect(parseDatabaseRequest({ id: 1, method: 'listMailboxes' })).toEqual({
      id: 1,
      method: 'listMailboxes',
    })
    expect(() =>
      parseDatabaseRequest({ id: 1, method: 'listMailboxes', input: undefined }),
    ).toThrow(/./)
    expect(() => parseDatabaseRequest({ id: 1, method: 'getMailbox' })).toThrow(/./)
    expect(parseDatabaseRequest({ id: 1, method: 'getMailbox', input: 'mailbox' })).toEqual({
      id: 1,
      method: 'getMailbox',
      input: 'mailbox',
    })
  })

  it('rejects structured-clone-valid malformed method input before dispatch', () => {
    expect(() =>
      parseDatabaseRequest({
        id: 1,
        method: 'applyHistoryPage',
        input: {
          mailboxId: 'mailbox',
          batch: new Map(),
          targetCursor: 'cursor',
          updatedAt: '2025-01-01T00:00:00.000Z',
          fence: { ownerId: 'owner', fencingToken: 1, now: '2025-01-01T00:00:00.000Z' },
        },
      }),
    ).toThrow(/./)
  })

  it('rejects malformed error, event, and protocol envelopes; result payload stays unknown', () => {
    expect(() => parseDatabaseWorkerMessage({ kind: 'ready', extra: true })).toThrow(/./)
    expect(() =>
      parseDatabaseWorkerMessage({ kind: 'result', id: 1, method: 'getMailbox' }),
    ).toThrow(/./)
    expect(() =>
      parseDatabaseWorkerMessage({ kind: 'error', id: 1, method: 'getMailbox', message: 1 }),
    ).toThrow(/./)
    expect(() =>
      parseDatabaseWorkerMessage({
        kind: 'error',
        id: 1,
        method: 'getMailbox',
        error: { name: 'Error', message: 'x', code: 'BAD CODE' },
      }),
    ).toThrow(/./)
    expect(() =>
      parseDatabaseWorkerMessage({
        kind: 'committed-changes',
        changes: { conversations: false },
      }),
    ).toThrow(/./)
    expect(() => parseDatabaseWorkerMessage({ kind: 'protocol-error', message: 1 })).toThrow(/./)
    expect(
      parseDatabaseWorkerMessage({
        kind: 'result',
        id: 1,
        method: 'listMailboxes',
        result: ['not a mailbox summary'],
      }),
    ).toEqual({
      kind: 'result',
      id: 1,
      method: 'listMailboxes',
      result: ['not a mailbox summary'],
    })
    expect(parseDatabaseWorkerMessage({ kind: 'closed' })).toEqual({ kind: 'closed' })
  })

  it('serializes and reconstructs ordinary, coded, and non-Error throws', () => {
    const ordinary = serializeDatabaseError(new Error('SQLite unavailable'))
    expect(ordinary).toEqual({ name: 'Error', message: 'SQLite unavailable' })
    expect(reconstructDatabaseError(ordinary)).toMatchObject({
      name: 'Error',
      message: 'SQLite unavailable',
    })

    const coded = Object.assign(new Error('DRAFT_VERSION_CONFLICT'), {
      code: 'DRAFT_VERSION_CONFLICT',
      cause: Object.assign(new Error('inner'), { code: 'INNER' }),
    })
    const codedEnvelope = serializeDatabaseError(coded)
    expect(codedEnvelope).toEqual({
      name: 'Error',
      message: 'DRAFT_VERSION_CONFLICT',
      code: 'DRAFT_VERSION_CONFLICT',
      cause: { name: 'Error', message: 'inner', code: 'INNER' },
    })
    expect(reconstructDatabaseError(codedEnvelope)).toMatchObject({
      name: 'Error',
      message: 'DRAFT_VERSION_CONFLICT',
      code: 'DRAFT_VERSION_CONFLICT',
      cause: expect.objectContaining({ message: 'inner', code: 'INNER' }),
    })

    expect(serializeDatabaseError('string-throw')).toEqual({
      name: 'Error',
      message: 'string-throw',
    })
    expect(serializeDatabaseError(Symbol('x'))).toEqual({
      name: 'Error',
      message: 'Database worker failed',
    })
  })

  it('sanitizes secrets, emails, raw rows, control chars, throwing getters, and cycles', () => {
    const toxic = new Error(
      'token access_token=abc123 password=hunter2 user@example.com {"rowid":1,"mailbox_id":"m","access_token":"x"} \u0007',
    )
    Object.defineProperty(toxic, 'code', {
      get() {
        throw new Error('code getter boom')
      },
    })
    const cyclic = new Error('outer')
    cyclic.cause = cyclic
    toxic.cause = cyclic

    const envelope = serializeDatabaseError(toxic)
    expect(envelope.message).not.toMatch(/abc123|hunter2|user@example\.com|rowid/)
    expect(envelope.message).toContain('[REDACTED]')
    expect(envelope).not.toHaveProperty('stack')
    expect(envelope.code).toBeUndefined()
    expect(envelope.cause).toEqual({ name: 'Error', message: 'outer' })

    const throwingName = new Error('safe-message')
    Object.defineProperty(throwingName, 'name', {
      get() {
        throw new Error('name getter boom')
      },
    })
    expect(serializeDatabaseError(throwingName)).toEqual({
      name: 'Error',
      message: 'safe-message',
    })

    const reconstructed = reconstructDatabaseError(envelope)
    expect(reconstructed.message).toContain('[REDACTED]')
    expect(reconstructed.message).not.toMatch(/access_token=abc123/)
    expect('stack' in reconstructed).toBe(true)
  })

  it('never throws on Proxy getPrototypeOf traps and classifies worker catch safely', () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('getPrototypeOf')
        },
        get() {
          throw new Error('get')
        },
      },
    )
    expect(() => hostile instanceof Error).toThrow(/getPrototypeOf/)
    expect(() => serializeDatabaseError(hostile)).not.toThrow()
    expect(serializeDatabaseError(hostile)).toEqual({
      name: 'Error',
      message: 'Database worker failed',
    })

    const hostileWithSecrets = new Proxy(
      { name: 'Error', message: 'access_token=leak password=x user@example.com' },
      {
        getPrototypeOf() {
          throw new Error('getPrototypeOf')
        },
        get(target, property) {
          if (property === 'name' || property === 'message')
            return Reflect.get(target, property as string)
          throw new Error('get')
        },
      },
    )
    const secretEnvelope = serializeDatabaseError(hostileWithSecrets)
    expect(secretEnvelope.message).toContain('[REDACTED]')
    expect(secretEnvelope.message).not.toMatch(/access_token=leak|password=x|user@example\.com/)
    expect(secretEnvelope.message.length).toBeLessThanOrEqual(500)

    const protocol = Object.assign(new Error('Invalid getMailbox result'), {
      name: 'DatabaseProtocolError',
    })
    expect(workerOperationFailureMessage(protocol, { id: 1, method: 'listMailboxes' })).toEqual({
      kind: 'protocol-error',
      error: { name: 'DatabaseProtocolError', message: 'Invalid getMailbox result' },
    })
    expect(workerOperationFailureMessage(hostile, { id: 2, method: 'listMailboxes' })).toEqual({
      kind: 'error',
      id: 2,
      method: 'listMailboxes',
      error: { name: 'Error', message: 'Database worker failed' },
    })
    expect(workerCloseFailureMessage(hostile)).toEqual({
      kind: 'close-error',
      error: { name: 'Error', message: 'Database worker failed' },
    })
    expect(workerCloseFailureMessage(Symbol('x'))).toEqual({
      kind: 'close-error',
      error: { name: 'Error', message: 'Database worker failed' },
    })
    expect(serializeDatabaseError(123n)).toEqual({
      name: 'Error',
      message: 'Database worker failed',
    })
  })

  it('parses worker error envelopes and rejects malformed ones', () => {
    expect(
      parseDatabaseWorkerMessage({
        kind: 'error',
        id: 1,
        method: 'listMailboxes',
        error: { name: 'TypeError', message: 'boom', code: 'X' },
      }),
    ).toEqual({
      kind: 'error',
      id: 1,
      method: 'listMailboxes',
      error: { name: 'TypeError', message: 'boom', code: 'X' },
    })
    expect(
      parseDatabaseWorkerMessage({
        kind: 'protocol-error',
        error: { name: 'DatabaseProtocolError', message: 'Invalid getMailbox result' },
      }),
    ).toEqual({
      kind: 'protocol-error',
      error: { name: 'DatabaseProtocolError', message: 'Invalid getMailbox result' },
    })
    expect(
      parseDatabaseWorkerMessage({
        kind: 'close-error',
        error: { name: 'Error', message: 'close failed' },
      }),
    ).toEqual({
      kind: 'close-error',
      error: { name: 'Error', message: 'close failed' },
    })
    expect(() =>
      parseDatabaseWorkerMessage({
        kind: 'error',
        id: 1,
        method: 'listMailboxes',
        error: { name: 1, message: 'x' },
      }),
    ).toThrow(/./)
  })
})

describe('database operation registry', () => {
  it('keeps registry keys paired with method-specific operations', () => {
    const mismatchedRegistry = {
      ...databaseOperations,
      // @ts-expect-error Registry keys cannot use another method's operation.
      getMailbox: databaseOperations.listMailboxes,
    } satisfies DatabaseOperationRegistry

    expect(mismatchedRegistry.getMailbox).toBe(databaseOperations.listMailboxes)
  })

  it('contains every operation and dispatches through the matching store method', async () => {
    const listMailboxes = vi.fn<() => Promise<unknown[]>>(async () => [])
    const getMailbox = vi.fn<() => Promise<typeof databaseRpcFixtures.getMailbox.result>>(
      async () => databaseRpcFixtures.getMailbox.result,
    )
    const store = { listMailboxes, getMailbox } as unknown as MailStore

    await expect(
      dispatchDatabaseOperation(store, { id: 1, method: 'listMailboxes' }),
    ).resolves.toEqual([])
    await expect(
      dispatchDatabaseOperation(store, {
        id: 2,
        method: 'getMailbox',
        input: mailboxId('mailbox'),
      }),
    ).resolves.toEqual(databaseRpcFixtures.getMailbox.result)
    expect(listMailboxes).toHaveBeenCalledOnce()
    expect(getMailbox).toHaveBeenCalledWith('mailbox')
  })

  it('turns invalid store output into a protocol error without relabeling store errors', async () => {
    const malformedStore = {
      getMailbox: async () => 'not-a-mailbox',
    } as unknown as MailStore
    await expect(
      dispatchDatabaseOperation(malformedStore, {
        id: 1,
        method: 'getMailbox',
        input: mailboxId('mailbox'),
      }),
    ).rejects.toThrow('Invalid getMailbox result')

    const failingStore = {
      getMailbox: async () => {
        throw new Error('SQLite unavailable')
      },
    } as unknown as MailStore
    await expect(
      dispatchDatabaseOperation(failingStore, {
        id: 2,
        method: 'getMailbox',
        input: mailboxId('mailbox'),
      }),
    ).rejects.toThrow('SQLite unavailable')
  })
})
