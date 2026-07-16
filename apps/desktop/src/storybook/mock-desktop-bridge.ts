import type {
  CommandReceipt,
  ConversationDetail,
  DesktopBridge,
  ExportAttachmentResult,
  IpcResult,
} from '@mailrovers/mail-contracts'
import { storybookFixtures } from './storybook-fixtures.js'
import type {
  ScenarioResponse,
  ScenarioSequence,
  StorybookScenario,
  TimedEvent,
} from './storybook-scenarios.js'

function never<Value>(): Promise<Value> {
  return new Promise(() => {})
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function ok<Value>(value: Value): IpcResult<Value> {
  return { ok: true, value }
}

function responseAt<Value>(
  configured: ScenarioSequence<Value> | undefined,
  invocation: number,
  fallback: Value,
): ScenarioResponse<Value> {
  if (configured === undefined) return { kind: 'success', value: fallback }
  if ('kind' in configured) return configured
  return configured[Math.min(invocation, configured.length - 1)] ?? configured[0]
}

async function settle<Value>(response: ScenarioResponse<Value>): Promise<IpcResult<Value>> {
  if (response.kind === 'pending') return never()
  if (response.delayMs !== undefined) await delay(response.delayMs)
  if (response.kind === 'failure') return { ok: false, error: response.error }
  return ok(response.value)
}

function scheduleEvents<Event>(
  events: readonly TimedEvent<Event>[] | undefined,
  callback: (event: Event) => void,
): () => void {
  const timers = (events ?? []).map(({ event, delayMs }) =>
    window.setTimeout(() => callback(event), delayMs),
  )
  return () => {
    for (const timer of timers) window.clearTimeout(timer)
  }
}

export function createStorybookBridge(scenario: StorybookScenario): DesktopBridge {
  const invocations = new Map<string, number>()

  const respond = <Value>(
    operation: string,
    configured: ScenarioSequence<Value> | undefined,
    fallback: Value,
  ): Promise<IpcResult<Value>> => {
    const invocation = invocations.get(operation) ?? 0
    invocations.set(operation, invocation + 1)
    return settle(responseAt(configured, invocation, fallback))
  }

  const bridge = {
    v1: {
      listConversations: () =>
        respond(
          'listConversations',
          scenario.responses?.listConversations,
          scenario.data.conversations,
        ),
      listMailboxes: () =>
        respond('listMailboxes', scenario.responses?.listMailboxes, scenario.data.mailboxes),
      listLabels: () => respond('listLabels', scenario.responses?.listLabels, scenario.data.labels),
      getConversation: () =>
        respond(
          'getConversation',
          scenario.responses?.getConversation,
          scenario.data.conversation ?? null,
        ),
      getMessageBody: (input) =>
        respond(
          'getMessageBody',
          scenario.responses?.getMessageBody,
          storybookFixtures.messageBodies.get(input.messageId) ?? null,
        ),
      exportAttachment: (_input) =>
        respond<ExportAttachmentResult>('exportAttachment', scenario.responses?.exportAttachment, {
          status: 'exported',
          attachmentId: attachmentIdFromFixture(),
        }),
      searchMail: () => respond('searchMail', scenario.responses?.searchMail, scenario.data.search),
      executeCommand: (input) =>
        respond('executeCommand', scenario.responses?.executeCommand, {
          ...storybookFixtures.commandReceipt,
          command: input.command,
        } satisfies CommandReceipt),
      undoCommand: () =>
        respond('undoCommand', scenario.responses?.undoCommand, storybookFixtures.commandReceipt),
      listCommandIssues: () =>
        respond(
          'listCommandIssues',
          scenario.responses?.listCommandIssues,
          scenario.data.commandIssues,
        ),
      resolveCommand: () => respond('resolveCommand', scenario.responses?.resolveCommand, null),
      saveDraft: () => respond('saveDraft', scenario.responses?.saveDraft, storybookFixtures.draft),
      getDraft: (input) =>
        Promise.resolve(
          ok(scenario.data.drafts.find((draft) => draft.id === input.draftId) ?? null),
        ),
      listDrafts: () => respond('listDrafts', scenario.responses?.listDrafts, scenario.data.drafts),
      sendDraft: () =>
        respond('sendDraft', scenario.responses?.sendDraft, storybookFixtures.sendReceipt),
      getAiConfiguration: () =>
        respond(
          'getAiConfiguration',
          scenario.responses?.getAiConfiguration,
          scenario.data.aiConfiguration,
        ),
      saveAiConfiguration: () =>
        respond(
          'saveAiConfiguration',
          scenario.responses?.saveAiConfiguration,
          scenario.data.aiConfiguration,
        ),
      clearAiConfiguration: () =>
        respond('clearAiConfiguration', scenario.responses?.clearAiConfiguration, null),
      validateAiConfiguration: () =>
        respond(
          'validateAiConfiguration',
          scenario.responses?.validateAiConfiguration,
          scenario.data.aiConfiguration,
        ),
      startConversationSummary: () =>
        respond(
          'startConversationSummary',
          scenario.responses?.startConversationSummary,
          storybookFixtures.aiReceipt,
        ),
      startReplyDraft: () =>
        respond('startReplyDraft', scenario.responses?.startReplyDraft, {
          ...storybookFixtures.aiReceipt,
          artifactType: 'reply_draft',
        }),
      acceptAiReply: () =>
        respond('acceptAiReply', scenario.responses?.acceptAiReply, {
          ...storybookFixtures.draft,
          textBody: storybookFixtures.aiReplyArtifact.content,
          version: storybookFixtures.draft.version + 1,
        }),
      reviewAiArtifact: () =>
        respond('reviewAiArtifact', scenario.responses?.reviewAiArtifact, null),
      connectGmail: () =>
        respond('connectGmail', scenario.responses?.connectGmail, storybookFixtures.connectResult),
      disconnectMailbox: () =>
        respond('disconnectMailbox', scenario.responses?.disconnectMailbox, null),
      startSync: () =>
        respond('startSync', scenario.responses?.startSync, storybookFixtures.syncReceipt),
      getSyncStatus: () =>
        respond('getSyncStatus', scenario.responses?.getSyncStatus, scenario.data.syncStatus),
      cancelOperation: () => respond('cancelOperation', scenario.responses?.cancelOperation, null),
      subscribe: (_requestId, callback) => scheduleEvents(scenario.syncEvents, callback),
      subscribeOperation: (_requestId, _mailboxId, callback) =>
        scheduleEvents(scenario.aiEvents, callback),
    },
  } satisfies DesktopBridge

  return bridge
}

function attachmentIdFromFixture(): ConversationDetail['messages'][number]['attachments'][number]['id'] {
  const attachment = storybookFixtures.launchConversation.messages
    .flatMap((message) => message.attachments)
    .at(0)
  if (attachment === undefined) throw new Error('Storybook attachment fixture is missing')
  return attachment.id
}

export function installStorybookBridge(scenario: StorybookScenario): void {
  window.mailrovers = createStorybookBridge(scenario)
}
