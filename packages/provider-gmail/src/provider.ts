import type {
  MailProvider,
  ProviderCommandReconciliation,
  ProviderCommandResult,
  ProviderImportBatch,
  ResolvedProviderCommand,
  PullChangesResult,
} from '@mailrovers/mail-application'
import { utcTimestamp, type MailboxId, type WorkspaceId } from '@mailrovers/mail-domain'
import { GmailHttpClient } from './client.js'
import {
  parseGmailDraft,
  parseGmailMessage,
  gmailThreadSchema,
  historyResponseSchema,
  listDraftsSchema,
  listLabelsSchema,
  listMessagesSchema,
  profileSchema,
  type GmailMessage,
} from './schemas.js'
import { base64UrlMime, serializeDraft } from './mime.js'
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

  async executeCommand(
    input: ResolvedProviderCommand & { signal: AbortSignal },
  ): Promise<ProviderCommandResult> {
    const translate = (message: GmailMessage) =>
      translateMessage({
        workspaceId: this.input.workspaceId,
        mailboxId: input.mailboxId,
        message,
        now: this.now(),
      })
    switch (input.command.kind) {
      case 'set-thread-archived':
      case 'set-thread-read':
      case 'set-thread-label': {
        if (input.providerThreadId === undefined) throw new Error('Provider thread ID is required')
        const label =
          input.command.kind === 'set-thread-archived'
            ? 'INBOX'
            : input.command.kind === 'set-thread-read'
              ? 'UNREAD'
              : input.providerLabelId
        if (label === undefined) throw new Error('Provider label ID is required')
        const applied =
          input.command.kind === 'set-thread-archived'
            ? !input.command.archived
            : input.command.kind === 'set-thread-read'
              ? !input.command.read
              : input.command.applied
        await this.input.client.mutateSetLike(
          `/users/me/threads/${encodeURIComponent(input.providerThreadId)}/modify`,
          {
            signal: input.signal,
            body: applied ? { addLabelIds: [label] } : { removeLabelIds: [label] },
          },
        )
        const value = await this.input.client.request(
          `/users/me/threads/${encodeURIComponent(input.providerThreadId)}?format=full`,
          { signal: input.signal },
        )
        const thread = gmailThreadSchema.parse(value)
        return {
          changes: {
            messages: thread.messages.map((message) => translate(parseGmailMessage(message))),
          },
        }
      }
      case 'set-message-starred': {
        if (input.providerMessageId === undefined)
          throw new Error('Provider message ID is required')
        await this.input.client.mutateSetLike(
          `/users/me/messages/${encodeURIComponent(input.providerMessageId)}/modify`,
          {
            signal: input.signal,
            body: input.command.starred
              ? { addLabelIds: ['STARRED'] }
              : { removeLabelIds: ['STARRED'] },
          },
        )
        const message = await this.getMessage(input.providerMessageId, input.signal)
        return { changes: message === undefined ? {} : { messages: [translate(message)] } }
      }
      case 'sync-draft': {
        if (
          input.draft === undefined ||
          input.sender === undefined ||
          input.internetMessageId === undefined
        )
          throw new Error('Draft snapshot is required')
        const raw = base64UrlMime(
          serializeDraft({
            draft: input.draft,
            sender: input.sender,
            internetMessageId: input.internetMessageId,
            ...(input.replyInternetMessageId === undefined
              ? {}
              : { replyInternetMessageId: input.replyInternetMessageId }),
          }),
        )
        const body = {
          message: {
            raw,
            ...(input.providerThreadId === undefined ? {} : { threadId: input.providerThreadId }),
          },
        }
        const value = await this.input.client.mutateOnce(
          input.draft.providerDraftId === undefined
            ? '/users/me/drafts'
            : `/users/me/drafts/${encodeURIComponent(input.draft.providerDraftId)}`,
          {
            signal: input.signal,
            method: input.draft.providerDraftId === undefined ? 'POST' : 'PUT',
            body,
          },
        )
        const saved = parseGmailDraft(value)
        const draft = translateDraft({
          workspaceId: this.input.workspaceId,
          mailboxId: input.mailboxId,
          providerDraftId: saved.id,
          message: saved.message,
          now: this.now(),
        })
        return {
          changes: { drafts: [draft] },
          draftIdentity: {
            draftId: input.command.draftId,
            providerDraftId: saved.id,
            providerMessageId: saved.message.id,
          },
        }
      }
      case 'send-draft': {
        if (input.draft?.providerDraftId === undefined)
          throw new Error('Draft must sync before send')
        const value = await this.input.client.mutateOnce('/users/me/drafts/send', {
          signal: input.signal,
          method: 'POST',
          body: { id: input.draft.providerDraftId },
        })
        const sent = parseGmailMessage(value)
        return {
          changes: { messages: [translate(sent)] },
          sentDraftId: input.command.draftId,
        }
      }
    }
  }

  async reconcileCommand(
    input: ResolvedProviderCommand & { signal: AbortSignal },
  ): Promise<ProviderCommandReconciliation> {
    if (input.command.kind !== 'sync-draft' && input.command.kind !== 'send-draft')
      return { kind: 'not-applied' }
    if (input.internetMessageId === undefined) return { kind: 'uncertain' }
    const search = `rfc822msgid:${input.internetMessageId}`
    if (input.command.kind === 'sync-draft') {
      const value = await this.input.client.request(
        `/users/me/drafts${query({ maxResults: '20', q: search })}`,
        { signal: input.signal },
      )
      const drafts = listDraftsSchema.parse(value).drafts
      for (const candidate of drafts) {
        const detail = await this.input.client.request(
          `/users/me/drafts/${encodeURIComponent(candidate.id)}?format=full`,
          { signal: input.signal, allowNotFound: true },
        )
        if (detail === undefined) continue
        const found = parseGmailDraft(detail)
        const messageId = found.message.payload.headers?.find(
          (header) => header.name.toLowerCase() === 'message-id',
        )?.value
        if (messageId !== input.internetMessageId) continue
        const draft = translateDraft({
          workspaceId: this.input.workspaceId,
          mailboxId: input.mailboxId,
          providerDraftId: found.id,
          message: found.message,
          now: this.now(),
        })
        return {
          kind: 'applied',
          result: {
            changes: { drafts: [draft] },
            draftIdentity: {
              draftId: input.command.draftId,
              providerDraftId: found.id,
              providerMessageId: found.message.id,
            },
          },
        }
      }
      return { kind: 'uncertain' }
    }
    const value = await this.input.client.request(
      `/users/me/messages${query({ maxResults: '20', q: `in:sent ${search}` })}`,
      { signal: input.signal },
    )
    const candidates = listMessagesSchema.parse(value).messages
    for (const candidate of candidates) {
      const found = await this.getMessage(candidate.id, input.signal)
      if (found === undefined) continue
      const messageId = found.payload.headers?.find(
        (header) => header.name.toLowerCase() === 'message-id',
      )?.value
      if (messageId !== input.internetMessageId) continue
      return {
        kind: 'applied',
        result: {
          changes: {
            messages: [
              translateMessage({
                workspaceId: this.input.workspaceId,
                mailboxId: input.mailboxId,
                message: found,
                now: this.now(),
              }),
            ],
          },
          sentDraftId: input.command.draftId,
        },
      }
    }
    return { kind: 'uncertain' }
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
