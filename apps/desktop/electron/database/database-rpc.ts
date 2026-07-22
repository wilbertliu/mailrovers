import type { CommittedChangeSet, MailStore } from '@mailrovers/mail-application'
import { mailboxId } from '@mailrovers/mail-domain'
import {
  aiArtifactCodec,
  arrayCodec,
  booleanCodec,
  aiSourceSnapshotCodec,
  commandReceiptCodec,
  commandStateTransitionCodec,
  conversationDetailCodec,
  conversationPageCodec,
  draftCodec,
  getConversationInputCodec,
  getMessageBodyInputCodec,
  labelSummaryCodec,
  listConversationsInputCodec,
  mailboxCodec,
  mailboxSummariesCodec,
  messageBodyCodec,
  optionalCodec,
  resolvedAttachmentCodec,
  resolvedProviderCommandCodec,
  searchMailInputCodec,
  searchPageCodec,
  storedAiConfigurationCodec,
  storedCommandCodec,
  stringCodec,
  syncCheckpointCodec,
  syncLeaseCodec,
  uint8ArrayCodec,
  voidCodec,
  type DatabaseCodec,
} from './database-semantic-codecs.js'
import {
  acceptAiReplyInputCodec,
  acquireSyncLeaseInputCodec,
  applyHistoryPageInputCodec,
  applyImportBatchInputCodec,
  backfillSearchIndexInputCodec,
  beginDraftReconciliationInputCodec,
  beginFullReconciliationInputCodec,
  cancelMailboxCommandsInputCodec,
  claimNextCommandInputCodec,
  clearAiConfigurationInputCodec,
  completeCommandInputCodec,
  completeDraftReconciliationInputCodec,
  completeFullReconciliationInputCodec,
  completeHistoryInputCodec,
  enqueueCommandInputCodec,
  enqueueDraftCommandInputCodec,
  enqueueInverseCommandInputCodec,
  enqueueSendDraftInputCodec,
  findAiArtifactInputCodec,
  getAiArtifactInputCodec,
  getAiConfigurationInputCodec,
  getAttachmentForExportInputCodec,
  getDraftInputCodec,
  getEncryptedRefreshTokenInputCodec,
  getMailboxInputCodec,
  getMessageBodiesInputCodec,
  getSyncCheckpointInputCodec,
  listAttachmentCachePathsInputCodec,
  listCommandIssuesInputCodec,
  listDraftsInputCodec,
  listLabelsInputCodec,
  loadAiSourceSnapshotInputCodec,
  markAttachmentCachedInputCodec,
  messageBodiesResultCodec,
  releaseSyncLeaseInputCodec,
  removeMailboxInputCodec,
  renewSyncLeaseInputCodec,
  resetHistoryPaginationInputCodec,
  resetInitialImportInputCodec,
  reviewAiArtifactInputCodec,
  runPostImportMaintenanceInputCodec,
  saveAiConfigurationInputCodec,
  saveConnectedMailboxInputCodec,
  saveDraftStoreInputCodec,
  setAiConfigurationValidatedInputCodec,
  setImportStartInputCodec,
  setImportStateInputCodec,
  setMailboxAuthRequiredInputCodec,
  setSyncRetryInputCodec,
  stageDraftReconciliationInputCodec,
  stageFullReconciliationInputCodec,
} from './database-sync-codecs.js'

export type DatabaseMethod = keyof MailStore

export class DatabaseProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseProtocolError'
  }
}

type MethodArguments<Method extends DatabaseMethod> = Method extends DatabaseMethod
  ? MailStore[Method] extends (...args: infer Arguments) => unknown
    ? Arguments
    : never
  : never

export type DatabaseMethodInput<Method extends DatabaseMethod> =
  MethodArguments<Method> extends [] ? undefined : MethodArguments<Method>[0]

export type DatabaseMethodResult<Method extends DatabaseMethod> = Awaited<
  ReturnType<MailStore[Method]>
>

type DatabaseRequestFor<Method extends DatabaseMethod> = Method extends DatabaseMethod
  ? { id: number; method: Method } & (DatabaseMethodInput<Method> extends undefined
      ? { input?: never }
      : { input: DatabaseMethodInput<Method> })
  : never

export type DatabaseOperation<Method extends DatabaseMethod> = {
  readonly acceptsInput: boolean
  readonly input: DatabaseCodec<DatabaseMethodInput<Method>>
  readonly result: DatabaseCodec<DatabaseMethodResult<Method>>
  readonly invoke: (
    store: MailStore,
    input: DatabaseMethodInput<Method>,
  ) => Promise<DatabaseMethodResult<Method>>
}

export type DatabaseOperationRegistry = { [Method in DatabaseMethod]: DatabaseOperation<Method> }

/** The sole heterogeneous bridge. Its input is decoded by the selected operation first. */
function invokeDecodedStoreMethod<Method extends DatabaseMethod>(
  store: MailStore,
  method: Method,
  input: DatabaseMethodInput<Method>,
): Promise<DatabaseMethodResult<Method>> {
  const selected = store[method] as (
    ...argumentsList: [] | [DatabaseMethodInput<Method>]
  ) => Promise<DatabaseMethodResult<Method>>
  return input === undefined ? selected() : selected(input)
}

type InputDatabaseMethod = Exclude<DatabaseMethod, 'listMailboxes'>

function operation<Method extends InputDatabaseMethod>(
  method: Method,
  input: DatabaseCodec<DatabaseMethodInput<Method>>,
  result: DatabaseCodec<DatabaseMethodResult<Method>>,
): DatabaseOperation<Method> {
  return {
    acceptsInput: true,
    input,
    result,
    invoke(store, decodedInput) {
      return invokeDecodedStoreMethod(store, method, decodedInput)
    },
  }
}

function noInputOperation(
  method: 'listMailboxes',
  result: DatabaseCodec<DatabaseMethodResult<'listMailboxes'>>,
): DatabaseOperation<'listMailboxes'> {
  return {
    acceptsInput: false,
    input: voidCodec,
    result,
    invoke(store) {
      return invokeDecodedStoreMethod(store, method, undefined)
    },
  }
}

/** Every store method couples exact input and result codecs with its invocation. */
export const databaseOperations: DatabaseOperationRegistry = {
  listMailboxes: noInputOperation('listMailboxes', mailboxSummariesCodec),
  listConversations: operation(
    'listConversations',
    listConversationsInputCodec,
    conversationPageCodec,
  ),
  listLabels: operation('listLabels', listLabelsInputCodec, arrayCodec(labelSummaryCodec)),
  getConversation: operation(
    'getConversation',
    getConversationInputCodec,
    optionalCodec(conversationDetailCodec),
  ),
  getMessageBody: operation(
    'getMessageBody',
    getMessageBodyInputCodec,
    optionalCodec(messageBodyCodec),
  ),
  getAttachmentForExport: operation(
    'getAttachmentForExport',
    getAttachmentForExportInputCodec,
    optionalCodec(resolvedAttachmentCodec),
  ),
  markAttachmentCached: operation(
    'markAttachmentCached',
    markAttachmentCachedInputCodec,
    voidCodec,
  ),
  listAttachmentCachePaths: operation(
    'listAttachmentCachePaths',
    listAttachmentCachePathsInputCodec,
    arrayCodec(stringCodec),
  ),
  getMessageBodies: operation(
    'getMessageBodies',
    getMessageBodiesInputCodec,
    messageBodiesResultCodec,
  ),
  loadAiSourceSnapshot: operation(
    'loadAiSourceSnapshot',
    loadAiSourceSnapshotInputCodec,
    optionalCodec(aiSourceSnapshotCodec),
  ),
  searchMail: operation('searchMail', searchMailInputCodec, searchPageCodec),
  backfillSearchIndex: operation(
    'backfillSearchIndex',
    backfillSearchIndexInputCodec,
    booleanCodec,
  ),
  getMailbox: operation('getMailbox', getMailboxInputCodec, optionalCodec(mailboxCodec)),
  saveConnectedMailbox: operation(
    'saveConnectedMailbox',
    saveConnectedMailboxInputCodec,
    voidCodec,
  ),
  removeMailbox: operation('removeMailbox', removeMailboxInputCodec, voidCodec),
  getEncryptedRefreshToken: operation(
    'getEncryptedRefreshToken',
    getEncryptedRefreshTokenInputCodec,
    optionalCodec(uint8ArrayCodec),
  ),
  getAiConfiguration: operation(
    'getAiConfiguration',
    getAiConfigurationInputCodec,
    optionalCodec(storedAiConfigurationCodec),
  ),
  saveAiConfiguration: operation('saveAiConfiguration', saveAiConfigurationInputCodec, voidCodec),
  clearAiConfiguration: operation(
    'clearAiConfiguration',
    clearAiConfigurationInputCodec,
    voidCodec,
  ),
  setAiConfigurationValidated: operation(
    'setAiConfigurationValidated',
    setAiConfigurationValidatedInputCodec,
    voidCodec,
  ),
  findAiArtifact: operation(
    'findAiArtifact',
    findAiArtifactInputCodec,
    optionalCodec(aiArtifactCodec),
  ),
  getAiArtifact: operation(
    'getAiArtifact',
    getAiArtifactInputCodec,
    optionalCodec(aiArtifactCodec),
  ),
  saveAiArtifactIfCurrent: operation('saveAiArtifactIfCurrent', aiArtifactCodec, booleanCodec),
  saveAiArtifact: operation('saveAiArtifact', aiArtifactCodec, voidCodec),
  acceptAiReply: operation('acceptAiReply', acceptAiReplyInputCodec, optionalCodec(draftCodec)),
  reviewAiArtifact: operation('reviewAiArtifact', reviewAiArtifactInputCodec, voidCodec),
  getSyncCheckpoint: operation(
    'getSyncCheckpoint',
    getSyncCheckpointInputCodec,
    optionalCodec(syncCheckpointCodec),
  ),
  acquireSyncLease: operation(
    'acquireSyncLease',
    acquireSyncLeaseInputCodec,
    optionalCodec(syncLeaseCodec),
  ),
  renewSyncLease: operation('renewSyncLease', renewSyncLeaseInputCodec, booleanCodec),
  releaseSyncLease: operation('releaseSyncLease', releaseSyncLeaseInputCodec, booleanCodec),
  enqueueCommand: operation('enqueueCommand', enqueueCommandInputCodec, commandReceiptCodec),
  enqueueInverseCommand: operation(
    'enqueueInverseCommand',
    enqueueInverseCommandInputCodec,
    commandReceiptCodec,
  ),
  enqueueDraftCommand: operation(
    'enqueueDraftCommand',
    enqueueDraftCommandInputCodec,
    commandReceiptCodec,
  ),
  claimNextCommand: operation(
    'claimNextCommand',
    claimNextCommandInputCodec,
    optionalCodec(storedCommandCodec),
  ),
  resolveProviderCommand: operation(
    'resolveProviderCommand',
    storedCommandCodec,
    resolvedProviderCommandCodec,
  ),
  completeCommand: operation('completeCommand', completeCommandInputCodec, voidCodec),
  setCommandState: operation('setCommandState', commandStateTransitionCodec, voidCodec),
  cancelMailboxCommands: operation(
    'cancelMailboxCommands',
    cancelMailboxCommandsInputCodec,
    voidCodec,
  ),
  listCommandIssues: operation(
    'listCommandIssues',
    listCommandIssuesInputCodec,
    arrayCodec(commandReceiptCodec),
  ),
  saveDraft: operation('saveDraft', saveDraftStoreInputCodec, draftCodec),
  getDraft: operation('getDraft', getDraftInputCodec, optionalCodec(draftCodec)),
  listDrafts: operation('listDrafts', listDraftsInputCodec, arrayCodec(draftCodec)),
  enqueueSendDraft: operation('enqueueSendDraft', enqueueSendDraftInputCodec, commandReceiptCodec),
  beginDraftReconciliation: operation(
    'beginDraftReconciliation',
    beginDraftReconciliationInputCodec,
    voidCodec,
  ),
  stageDraftReconciliation: operation(
    'stageDraftReconciliation',
    stageDraftReconciliationInputCodec,
    voidCodec,
  ),
  completeDraftReconciliation: operation(
    'completeDraftReconciliation',
    completeDraftReconciliationInputCodec,
    voidCodec,
  ),
  setImportState: operation('setImportState', setImportStateInputCodec, voidCodec),
  setSyncRetry: operation('setSyncRetry', setSyncRetryInputCodec, voidCodec),
  setMailboxAuthRequired: operation(
    'setMailboxAuthRequired',
    setMailboxAuthRequiredInputCodec,
    voidCodec,
  ),
  resetHistoryPagination: operation(
    'resetHistoryPagination',
    resetHistoryPaginationInputCodec,
    voidCodec,
  ),
  beginFullReconciliation: operation(
    'beginFullReconciliation',
    beginFullReconciliationInputCodec,
    voidCodec,
  ),
  stageFullReconciliation: operation(
    'stageFullReconciliation',
    stageFullReconciliationInputCodec,
    voidCodec,
  ),
  completeFullReconciliation: operation(
    'completeFullReconciliation',
    completeFullReconciliationInputCodec,
    voidCodec,
  ),
  setImportStart: operation('setImportStart', setImportStartInputCodec, voidCodec),
  applyImportBatch: operation('applyImportBatch', applyImportBatchInputCodec, voidCodec),
  applyHistoryPage: operation('applyHistoryPage', applyHistoryPageInputCodec, voidCodec),
  completeHistory: operation('completeHistory', completeHistoryInputCodec, voidCodec),
  resetInitialImport: operation('resetInitialImport', resetInitialImportInputCodec, voidCodec),
  runPostImportMaintenance: operation(
    'runPostImportMaintenance',
    runPostImportMaintenanceInputCodec,
    booleanCodec,
  ),
}

export type DatabaseRequest = {
  [Method in DatabaseMethod]: DatabaseRequestFor<Method>
}[DatabaseMethod]

type DatabaseResultMessage = { kind: 'result'; id: number; method: DatabaseMethod; result: unknown }
type DatabaseErrorMessage = { kind: 'error'; id: number; method: DatabaseMethod; message: string }
export type DatabaseWorkerMessage =
  | { kind: 'ready' }
  | { kind: 'committed-changes'; changes: CommittedChanges }
  | DatabaseResultMessage
  | DatabaseErrorMessage
  | { kind: 'protocol-error'; message: string }
export type CommittedChanges = CommittedChangeSet

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
export function isDatabaseMethod(value: unknown): value is DatabaseMethod {
  return typeof value === 'string' && Object.hasOwn(databaseOperations, value)
}

function noInputRequest(id: number): DatabaseRequestFor<'listMailboxes'> {
  return { id, method: 'listMailboxes' }
}

type InputDatabaseRequestFor<Method extends InputDatabaseMethod> = {
  id: number
  method: Method
  input: DatabaseMethodInput<Method>
}

function inputRequest<Method extends InputDatabaseMethod>(
  id: number,
  method: Method,
  input: DatabaseMethodInput<Method>,
): DatabaseRequestFor<Method> {
  return { id, method, input } as DatabaseRequestFor<Method>
}

export function decodeDatabaseInput<Method extends DatabaseMethod>(
  method: Method,
  value: unknown,
): DatabaseMethodInput<Method> {
  return databaseOperations[method].input.decode(value)
}
export function decodeDatabaseResult<Method extends DatabaseMethod>(
  method: Method,
  value: unknown,
): DatabaseMethodResult<Method> {
  return databaseOperations[method].result.decode(value)
}

export function parseDatabaseRequest(value: unknown): DatabaseRequest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'method', 'input']) ||
    !Object.hasOwn(value, 'id') ||
    !Object.hasOwn(value, 'method')
  )
    throw new Error('Invalid database request envelope')
  if (!isPositiveSafeInteger(value.id)) throw new Error('Invalid database request id')
  if (!isDatabaseMethod(value.method)) throw new Error('Unknown database method')
  if (value.method === 'listMailboxes') {
    if (Object.hasOwn(value, 'input')) throw new Error('listMailboxes does not accept input')
    return noInputRequest(value.id)
  }
  if (!Object.hasOwn(value, 'input') || value.input === undefined)
    throw new Error(`Database method ${value.method} requires input`)
  return inputRequest(value.id, value.method, decodeDatabaseInput(value.method, value.input))
}

function parseCommittedChanges(value: unknown): CommittedChanges {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['mailboxId', 'mailboxes', 'conversations', 'labels', 'drafts', 'outbox'])
  )
    throw new Error('Invalid committed changes envelope')
  const changes: CommittedChanges = {}
  if (Object.hasOwn(value, 'mailboxId')) {
    if (typeof value.mailboxId !== 'string') throw new Error('Invalid committed changes mailbox id')
    changes.mailboxId = mailboxId(value.mailboxId)
  }
  for (const key of ['mailboxes', 'conversations', 'labels', 'drafts', 'outbox'] as const) {
    if (Object.hasOwn(value, key) && value[key] !== true)
      throw new Error('Invalid committed changes flag')
    if (value[key] === true) changes[key] = true
  }
  return changes
}

export function parseDatabaseWorkerMessage(value: unknown): DatabaseWorkerMessage {
  if (!isRecord(value) || !Object.hasOwn(value, 'kind') || typeof value.kind !== 'string')
    throw new Error('Invalid database worker message envelope')
  switch (value.kind) {
    case 'ready':
      if (!hasOnlyKeys(value, ['kind'])) throw new Error('Invalid database worker ready message')
      return { kind: 'ready' }
    case 'committed-changes':
      if (!hasOnlyKeys(value, ['kind', 'changes']) || !Object.hasOwn(value, 'changes'))
        throw new Error('Invalid committed changes message')
      return { kind: 'committed-changes', changes: parseCommittedChanges(value.changes) }
    case 'result':
      if (
        !hasOnlyKeys(value, ['kind', 'id', 'method', 'result']) ||
        !Object.hasOwn(value, 'id') ||
        !Object.hasOwn(value, 'method') ||
        !Object.hasOwn(value, 'result')
      )
        throw new Error('Invalid database result message')
      if (!isPositiveSafeInteger(value.id) || !isDatabaseMethod(value.method))
        throw new Error('Invalid database result correlation')
      return {
        kind: 'result',
        id: value.id,
        method: value.method,
        result: value.result,
      }
    case 'error':
      if (
        !hasOnlyKeys(value, ['kind', 'id', 'method', 'message']) ||
        !Object.hasOwn(value, 'id') ||
        !Object.hasOwn(value, 'method')
      )
        throw new Error('Invalid database error message')
      if (
        !isPositiveSafeInteger(value.id) ||
        !isDatabaseMethod(value.method) ||
        typeof value.message !== 'string'
      )
        throw new Error('Invalid database error message')
      return { kind: 'error', id: value.id, method: value.method, message: value.message }
    case 'protocol-error':
      if (
        !hasOnlyKeys(value, ['kind', 'message']) ||
        !Object.hasOwn(value, 'message') ||
        typeof value.message !== 'string'
      )
        throw new Error('Invalid database protocol error')
      return { kind: 'protocol-error', message: value.message }
    default:
      throw new Error('Unknown database worker message')
  }
}

type InputDatabaseRequest = {
  [Method in InputDatabaseMethod]: InputDatabaseRequestFor<Method>
}[InputDatabaseMethod]

function decodeStoreResult<Method extends DatabaseMethod>(
  method: Method,
  decoder: DatabaseCodec<DatabaseMethodResult<Method>>,
  value: unknown,
): DatabaseMethodResult<Method> {
  try {
    return decoder.decode(value)
  } catch (error) {
    throw new DatabaseProtocolError(
      error instanceof Error
        ? `Invalid ${method} result: ${error.message}`
        : 'Invalid database result',
    )
  }
}

async function dispatchInputDatabaseOperation(
  store: MailStore,
  request: InputDatabaseRequest,
): Promise<DatabaseMethodResult<DatabaseMethod>> {
  // The request input has already been decoded by the operation selected by its method.
  const operation = databaseOperations[request.method] as DatabaseOperation<InputDatabaseMethod>
  const result = await operation.invoke(store, request.input)
  return decodeStoreResult(request.method, operation.result, result)
}

export async function dispatchDatabaseOperation(
  store: MailStore,
  request: DatabaseRequest,
): Promise<DatabaseMethodResult<DatabaseMethod>> {
  if (request.method === 'listMailboxes') {
    const result = await databaseOperations.listMailboxes.invoke(store, undefined)
    return decodeStoreResult('listMailboxes', databaseOperations.listMailboxes.result, result)
  }
  return dispatchInputDatabaseOperation(store, request)
}
