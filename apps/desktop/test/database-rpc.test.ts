import type { MailStore } from '@mailrovers/mail-application'
import { mailboxId } from '@mailrovers/mail-domain'
import { databaseRpcFixtures } from './fixtures/database-rpc-fixtures.js'
import { describe, expect, it, vi } from 'vitest'
import {
  databaseOperations,
  dispatchDatabaseOperation,
  parseDatabaseRequest,
  parseDatabaseWorkerMessage,
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
