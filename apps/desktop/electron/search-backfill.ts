import type { MailStore } from '@mailrovers/mail-application'
import { utcTimestamp } from '@mailrovers/mail-domain'
import { setTimeout as delay } from 'node:timers/promises'
import { SEARCH_BACKFILL_BATCH_LIMIT } from '../shared/indexing-measurements.js'

export type SearchBackfillBatch = {
  batchId: number
  execute: () => Promise<boolean>
}

export type SearchBackfillProbe = {
  start: () => void
  runBatch: (batch: SearchBackfillBatch) => Promise<boolean>
  complete: () => void
}

type BackfillSearchOptions = {
  shouldStop: () => boolean
  probe?: SearchBackfillProbe
  yieldToEventLoop?: () => Promise<unknown>
}

export async function backfillSearch(
  store: Pick<MailStore, 'listMailboxes' | 'backfillSearchIndex'>,
  {
    shouldStop,
    probe,
    yieldToEventLoop = () => delay(0),
  }: BackfillSearchOptions,
): Promise<void> {
  probe?.start()
  let batches = 0
  try {
    const mailboxes = await store.listMailboxes()
    for (const mailbox of mailboxes) {
      let complete = false
      while (!complete && !shouldStop()) {
        const batchId = batches + 1
        const execute = () =>
          store.backfillSearchIndex({
            mailboxId: mailbox.id,
            limit: SEARCH_BACKFILL_BATCH_LIMIT,
            updatedAt: utcTimestamp(new Date().toISOString()),
          })
        complete = probe
          ? await probe.runBatch({ batchId, execute })
          : await execute()
        batches += 1
        if (!complete) await yieldToEventLoop()
      }
    }
  } finally {
    probe?.complete()
  }
}
