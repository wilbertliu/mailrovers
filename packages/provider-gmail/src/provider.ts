import type {
  MailProvider,
  ProviderImportBatch,
  PullChangesResult,
} from '@mailrovers/mail-application'
import { utcTimestamp, type MailboxId, type WorkspaceId } from '@mailrovers/mail-domain'
import { GmailHttpClient } from './client.js'
import {
  parseGmailDraft,
  parseGmailMessage,
  historyResponseSchema,
  listDraftsSchema,
  listLabelsSchema,
  listMessagesSchema,
  profileSchema,
  type GmailMessage,
} from './schemas.js'
import { translateDraft, translateLabel, translateMessage } from './translate.js'

function query(parameters: Record<string, string | undefined>): string {
  const values = new URLSearchParams()
  for (const [name, value] of Object.entries(parameters))
    if (value !== undefined) values.set(name, value)
  const encoded = values.toString()
  return encoded.length === 0 ? '' : `?${encoded}`
}

function chunks<Value>(values: Value[], size: number): Value[][] {
  const result: Value[][] = []
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size))
  return result
}

async function mapConcurrent<Input, Output>(
  values: Input[],
  concurrency: number,
  map: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = []
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      const value = values[index]
      if (value === undefined) continue
      results[index] = await map(value)
    }
  })
  await Promise.all(workers)
  return results
}

export class GmailProvider implements MailProvider {
  constructor(
    private readonly input: {
      client: GmailHttpClient
      workspaceId: WorkspaceId
      now?: (() => Date) | undefined
      detailBatchSize?: number | undefined
      detailConcurrency?: number | undefined
    },
  ) {}

  private now(): ReturnType<typeof utcTimestamp> {
    return utcTimestamp((this.input.now?.() ?? new Date()).toISOString())
  }

  async getCurrentCursor(signal: AbortSignal): Promise<string> {
    const value = await this.input.client.request('/users/me/profile', { signal })
    return profileSchema.parse(value).historyId
  }

  private async getMessage(id: string, signal: AbortSignal): Promise<GmailMessage | undefined> {
    const value = await this.input.client.request(
      `/users/me/messages/${encodeURIComponent(id)}?format=full`,
      { signal, allowNotFound: true },
    )
    return value === undefined ? undefined : parseGmailMessage(value)
  }

  async *importMailbox(input: {
    mailboxId: MailboxId
    phase: 'labels' | 'messages' | 'drafts'
    pageToken?: string | undefined
    signal: AbortSignal
  }): AsyncIterable<ProviderImportBatch> {
    if (input.phase === 'labels') {
      const value = await this.input.client.request('/users/me/labels', { signal: input.signal })
      const response = listLabelsSchema.parse(value)
      yield {
        changes: {
          labels: response.labels.map((providerLabel) =>
            translateLabel({ mailboxId: input.mailboxId, providerLabel, now: this.now() }),
          ),
        },
        processedCount: response.labels.length,
        pageComplete: true,
      }
      return
    }

    if (input.phase === 'messages') {
      const value = await this.input.client.request(
        `/users/me/messages${query({
          maxResults: '100',
          pageToken: input.pageToken,
          includeSpamTrash: 'true',
        })}`,
        { signal: input.signal },
      )
      const page = listMessagesSchema.parse(value)
      const groups = chunks(page.messages, this.input.detailBatchSize ?? 25)
      if (groups.length === 0) {
        yield {
          changes: {},
          processedCount: 0,
          pageComplete: true,
          ...(page.nextPageToken === undefined ? {} : { nextPageToken: page.nextPageToken }),
          ...(page.resultSizeEstimate === undefined
            ? {}
            : { totalEstimate: page.resultSizeEstimate }),
        }
        return
      }
      for (const [index, group] of groups.entries()) {
        const details = await mapConcurrent(group, this.input.detailConcurrency ?? 5, ({ id }) =>
          this.getMessage(id, input.signal),
        )
        const messages = details
          .filter((message): message is GmailMessage => message !== undefined)
          .map((message) =>
            translateMessage({
              workspaceId: this.input.workspaceId,
              mailboxId: input.mailboxId,
              message,
              now: this.now(),
            }),
          )
        const pageComplete = index === groups.length - 1
        yield {
          changes: { messages },
          processedCount: group.length,
          pageComplete,
          ...(pageComplete && page.nextPageToken !== undefined
            ? { nextPageToken: page.nextPageToken }
            : {}),
          ...(page.resultSizeEstimate === undefined
            ? {}
            : { totalEstimate: page.resultSizeEstimate }),
        }
      }
      return
    }

    const value = await this.input.client.request(
      `/users/me/drafts${query({ maxResults: '100', pageToken: input.pageToken })}`,
      { signal: input.signal },
    )
    const page = listDraftsSchema.parse(value)
    const groups = chunks(page.drafts, this.input.detailBatchSize ?? 25)
    if (groups.length === 0) {
      yield {
        changes: {},
        processedCount: 0,
        pageComplete: true,
        ...(page.nextPageToken === undefined ? {} : { nextPageToken: page.nextPageToken }),
      }
      return
    }
    for (const [index, group] of groups.entries()) {
      const drafts = await mapConcurrent(
        group,
        this.input.detailConcurrency ?? 5,
        async ({ id }) => {
          const detail = await this.input.client.request(
            `/users/me/drafts/${encodeURIComponent(id)}?format=full`,
            { signal: input.signal, allowNotFound: true },
          )
          if (detail === undefined) return undefined
          return parseGmailDraft(detail)
        },
      )
      const normalized = drafts
        .filter((draft): draft is NonNullable<typeof draft> => draft !== undefined)
        .map((draft) =>
          translateDraft({
            workspaceId: this.input.workspaceId,
            mailboxId: input.mailboxId,
            providerDraftId: draft.id,
            message: draft.message,
            now: this.now(),
          }),
        )
      const pageComplete = index === groups.length - 1
      yield {
        changes: { drafts: normalized },
        processedCount: group.length,
        pageComplete,
        ...(pageComplete && page.nextPageToken !== undefined
          ? { nextPageToken: page.nextPageToken }
          : {}),
      }
    }
  }

  async pullChanges(input: {
    mailboxId: MailboxId
    startCursor: string
    pageToken?: string | undefined
    signal: AbortSignal
  }): Promise<PullChangesResult> {
    const value = await this.input.client.request(
      `/users/me/history${query({
        startHistoryId: input.startCursor,
        pageToken: input.pageToken,
        maxResults: '100',
      })}`,
      { signal: input.signal },
    )
    const response = historyResponseSchema.parse(value)
    const changed = new Set<string>()
    const deleted = new Set<string>()
    for (const history of response.history) {
      for (const entry of history.messagesAdded ?? []) changed.add(entry.message.id)
      for (const entry of history.labelsAdded ?? []) changed.add(entry.message.id)
      for (const entry of history.labelsRemoved ?? []) changed.add(entry.message.id)
      for (const entry of history.messagesDeleted ?? []) deleted.add(entry.message.id)
    }
    for (const id of deleted) changed.delete(id)
    const details = await mapConcurrent([...changed], this.input.detailConcurrency ?? 5, (id) =>
      this.getMessage(id, input.signal),
    )
    const messages = details
      .filter((message): message is GmailMessage => message !== undefined)
      .map((message) =>
        translateMessage({
          workspaceId: this.input.workspaceId,
          mailboxId: input.mailboxId,
          message,
          now: this.now(),
        }),
      )
    return {
      changes: { messages, deletedProviderMessageIds: [...deleted] },
      historyId: response.historyId,
      ...(response.nextPageToken === undefined ? {} : { nextPageToken: response.nextPageToken }),
    }
  }
}
