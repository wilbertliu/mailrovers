import type { MailStore } from '@mailrovers/mail-application'
import { describe, expect, it } from 'vitest'
import {
  databaseOperations,
  decodeDatabaseResult,
  dispatchDatabaseOperation,
  parseDatabaseRequest,
  parseDatabaseWorkerMessage,
  type DatabaseMethod,
} from '../electron/database/database-rpc.js'
import { databaseRpcFixtureMethods, databaseRpcFixtures } from './fixtures/database-rpc-fixtures.js'

function requestFor(method: DatabaseMethod, id: number) {
  const fixture = databaseRpcFixtures[method]
  return method === 'listMailboxes'
    ? parseDatabaseRequest({ id, method })
    : parseDatabaseRequest({ id, method, input: fixture.input })
}

describe('database RPC operation catalog', () => {
  it('has one typed fixture row for every operation', () => {
    expect(Object.keys(databaseOperations).sort()).toEqual([...databaseRpcFixtureMethods].sort())
  })

  it('decodes each canonical request and result and rejects structured-clone-invalid values', () => {
    for (const [index, method] of databaseRpcFixtureMethods.entries()) {
      const fixture = databaseRpcFixtures[method]
      requestFor(method, index + 1)
      expect(
        parseDatabaseWorkerMessage({
          kind: 'result',
          id: index + 1,
          method,
          result: fixture.result,
        }),
      ).toEqual({
        kind: 'result',
        id: index + 1,
        method,
        result: fixture.result,
      })
      expect(decodeDatabaseResult(method, fixture.result)).toEqual(fixture.result)
      expect(() => decodeDatabaseResult(method, new Map())).toThrow(/./)
      expect(() => parseDatabaseRequest({ id: index + 1, method, input: new Map() })).toThrow(/./)
    }
  })

  it('dispatches every request through its same-named store method', async () => {
    const calls: PropertyKey[] = []
    const store = new Proxy(
      {},
      {
        get(_target, property) {
          return async () => {
            calls.push(property)
            return databaseRpcFixtures[property as DatabaseMethod].result
          }
        },
      },
    ) as MailStore

    for (const [index, method] of databaseRpcFixtureMethods.entries()) {
      const result = await dispatchDatabaseOperation(store, requestFor(method, index + 1))
      expect(result).toEqual(databaseRpcFixtures[method].result)
    }
    expect(calls).toEqual(databaseRpcFixtureMethods)
  })

  it('rejects deep malformed provider batches before a store call', () => {
    expect(() =>
      parseDatabaseRequest({
        id: 1,
        method: 'applyHistoryPage',
        input: {
          mailboxId: 'mailbox-1',
          batch: { messages: [{ id: 'message-1', attachments: new Map() }] },
          targetCursor: 'cursor-1',
          updatedAt: '2026-07-21T00:00:00.000Z',
          fence: { ownerId: 'owner-1', fencingToken: 1, now: '2026-07-21T00:00:00.000Z' },
        },
      }),
    ).toThrow(/./)
  })
})
