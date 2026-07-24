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

/** Bounded, structured-clone-safe error shape for the worker boundary. */
export type DatabaseErrorCauseEnvelope = {
  name: string
  message: string
  code?: string
}

export type DatabaseErrorEnvelope = {
  name: string
  message: string
  code?: string
  cause?: DatabaseErrorCauseEnvelope
}

const ERROR_MESSAGE_MAX_LENGTH = 500
const ERROR_NAME_MAX_LENGTH = 128
const ERROR_CODE_MAX_LENGTH = 128
const ERROR_CAUSE_MAX_DEPTH = 1
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.:-]+$/
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9._-]*$/
const SECRET_IN_TEXT =
  /(?:bearer\s+\S+|(?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|passwd|token)\s*[:=]\s*\S+)/gi
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const RAW_ROW_JSON =
  /\{[^{}]{0,2000}(?:"?(?:password|access_token|refresh_token|rowid|mailbox_id|encrypted|token)"?\s*:)[^{}]{0,2000}\}/gi
const ALLOWED_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'DatabaseProtocolError',
])

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength)
}

function safeRead(read: () => unknown): unknown {
  try {
    return read()
  } catch {
    return undefined
  }
}

function stripControlCharacters(value: string): string {
  let result = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    const isControl =
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    if (!isControl) result += character
  }
  return result
}

function sanitizeErrorText(value: string): string {
  const withoutControls = stripControlCharacters(value)
  const scrubbed = withoutControls
    .replace(SECRET_IN_TEXT, '[REDACTED]')
    .replace(EMAIL_ADDRESS, '[REDACTED]')
    .replace(RAW_ROW_JSON, '[REDACTED]')
  const normalized = scrubbed.length === 0 ? 'Database worker failed' : scrubbed
  return truncateText(normalized, ERROR_MESSAGE_MAX_LENGTH)
}

function normalizeErrorName(value: unknown): string {
  const raw = safeRead(() => value)
  if (typeof raw !== 'string' || raw.length === 0) return 'Error'
  const cleaned = stripControlCharacters(raw)
  if (!SAFE_ERROR_NAME.test(cleaned) || cleaned.length > ERROR_NAME_MAX_LENGTH) return 'Error'
  if (ALLOWED_ERROR_NAMES.has(cleaned)) return cleaned
  // Preserve simple coded-style names such as custom operational Error subclasses.
  if (/^[A-Za-z][A-Za-z0-9]{0,63}(?:Error)?$/.test(cleaned)) return cleaned
  return 'Error'
}

function readSafeErrorCode(value: unknown): string | undefined {
  const raw = safeRead(() => value)
  if (typeof raw !== 'string') return undefined
  if (raw.length === 0 || raw.length > ERROR_CODE_MAX_LENGTH) return undefined
  if (!SAFE_ERROR_CODE.test(raw)) return undefined
  return raw
}

function isObjectLike(value: unknown): value is object {
  const type = typeof value
  return (type === 'object' && value !== null) || type === 'function'
}

/**
 * Serialize without `instanceof` / prototype walks. Hostile Proxies with throwing
 * getPrototypeOf/get traps must still produce a bounded envelope and never throw.
 */
function serializeErrorLevel(
  error: unknown,
  depth: number,
  seen: WeakSet<object>,
): DatabaseErrorEnvelope | undefined {
  if (error === undefined || error === null) return undefined

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error.length > 0 ? sanitizeErrorText(error) : 'Database worker failed',
    }
  }
  if (typeof error !== 'object' && typeof error !== 'function') {
    return { name: 'Error', message: 'Database worker failed' }
  }

  const object: object = error
  try {
    if (seen.has(object)) return { name: 'Error', message: 'Database worker failed' }
    seen.add(object)
  } catch {
    return { name: 'Error', message: 'Database worker failed' }
  }

  const name = normalizeErrorName(safeRead(() => Reflect.get(object, 'name')))
  const messageRaw = safeRead(() => Reflect.get(object, 'message'))
  const message =
    typeof messageRaw === 'string' && messageRaw.length > 0
      ? sanitizeErrorText(messageRaw)
      : 'Database worker failed'
  const envelope: DatabaseErrorEnvelope = { name, message }
  const code = readSafeErrorCode(safeRead(() => Reflect.get(object, 'code')))
  if (code !== undefined) envelope.code = code

  if (depth < ERROR_CAUSE_MAX_DEPTH) {
    const causeValue = safeRead(() => Reflect.get(object, 'cause'))
    if (causeValue !== undefined && causeValue !== null) {
      const cause = serializeErrorLevel(causeValue, depth + 1, seen)
      if (cause !== undefined) {
        envelope.cause = {
          name: cause.name,
          message: cause.message,
          ...(cause.code === undefined ? {} : { code: cause.code }),
        }
      }
    }
  }
  return envelope
}

const FALLBACK_ERROR_ENVELOPE: DatabaseErrorEnvelope = {
  name: 'Error',
  message: 'Database worker failed',
}

/** Serialize any thrown value into a bounded envelope (no secrets, no stack, no raw rows). Never throws. */
export function serializeDatabaseError(error: unknown): DatabaseErrorEnvelope {
  try {
    return serializeErrorLevel(error, 0, new WeakSet<object>()) ?? FALLBACK_ERROR_ENVELOPE
  } catch {
    return { ...FALLBACK_ERROR_ENVELOPE }
  }
}

/** True when a thrown value is a DatabaseProtocolError (name only; no instanceof). */
export function isDatabaseProtocolErrorValue(error: unknown): boolean {
  if (!isObjectLike(error)) return false
  return normalizeErrorName(safeRead(() => Reflect.get(error, 'name'))) === 'DatabaseProtocolError'
}

/** Worker operation catch → protocol-error or correlated error; never throws. */
export function workerOperationFailureMessage(
  error: unknown,
  request: { id: number; method: DatabaseMethod },
):
  | { kind: 'protocol-error'; error: DatabaseErrorEnvelope }
  | { kind: 'error'; id: number; method: DatabaseMethod; error: DatabaseErrorEnvelope } {
  const envelope = serializeDatabaseError(error)
  if (isDatabaseProtocolErrorValue(error) || envelope.name === 'DatabaseProtocolError') {
    return { kind: 'protocol-error', error: envelope }
  }
  return { kind: 'error', id: request.id, method: request.method, error: envelope }
}

/** Worker close catch → close-error; never throws. */
export function workerCloseFailureMessage(error: unknown): {
  kind: 'close-error'
  error: DatabaseErrorEnvelope
} {
  return { kind: 'close-error', error: serializeDatabaseError(error) }
}

/** Rebuild an Error from a validated envelope (name, message, optional code/cause). */
export function reconstructDatabaseError(envelope: DatabaseErrorEnvelope): Error {
  const error = new Error(envelope.message)
  error.name = envelope.name
  if (envelope.code !== undefined) Object.assign(error, { code: envelope.code })
  if (envelope.cause !== undefined) {
    const cause = new Error(envelope.cause.message)
    cause.name = envelope.cause.name
    if (envelope.cause.code !== undefined) Object.assign(cause, { code: envelope.cause.code })
    error.cause = cause
  }
  return error
}

function parseDatabaseErrorEnvelope(value: unknown, label: string): DatabaseErrorEnvelope {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name', 'message', 'code', 'cause']))
    throw new Error(`Invalid ${label}`)
  if (typeof value.name !== 'string' || typeof value.message !== 'string')
    throw new Error(`Invalid ${label}`)
  const envelope: DatabaseErrorEnvelope = {
    name: normalizeErrorName(value.name),
    message: sanitizeErrorText(value.message),
  }
  if (Object.hasOwn(value, 'code')) {
    const code = readSafeErrorCode(value.code)
    if (code === undefined) throw new Error(`Invalid ${label} code`)
    envelope.code = code
  }
  if (Object.hasOwn(value, 'cause')) {
    if (
      !isRecord(value.cause) ||
      !hasOnlyKeys(value.cause, ['name', 'message', 'code']) ||
      typeof value.cause.name !== 'string' ||
      typeof value.cause.message !== 'string'
    )
      throw new Error(`Invalid ${label} cause`)
    const cause: DatabaseErrorCauseEnvelope = {
      name: normalizeErrorName(value.cause.name),
      message: sanitizeErrorText(value.cause.message),
    }
    if (Object.hasOwn(value.cause, 'code')) {
      const code = readSafeErrorCode(value.cause.code)
      if (code === undefined) throw new Error(`Invalid ${label} cause code`)
      cause.code = code
    }
    envelope.cause = cause
  }
  return envelope
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
type DatabaseErrorMessage = {
  kind: 'error'
  id: number
  method: DatabaseMethod
  error: DatabaseErrorEnvelope
}
export type DatabaseWorkerMessage =
  | { kind: 'ready' }
  | { kind: 'committed-changes'; changes: CommittedChanges }
  | DatabaseResultMessage
  | DatabaseErrorMessage
  | { kind: 'protocol-error'; error: DatabaseErrorEnvelope }
  | { kind: 'closed' }
  | { kind: 'close-error'; error: DatabaseErrorEnvelope }
export type DatabaseHostControlMessage = { kind: 'close' }
export type CommittedChanges = CommittedChangeSet

export function isDatabaseHostControlMessage(value: unknown): value is DatabaseHostControlMessage {
  return isRecord(value) && hasOnlyKeys(value, ['kind']) && value.kind === 'close'
}

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
    !hasOnlyKeys(value, [
      'mailboxId',
      'mailboxes',
      'conversations',
      'labels',
      'drafts',
      'outbox',
      'search',
    ])
  )
    throw new Error('Invalid committed changes envelope')
  const changes: CommittedChanges = {}
  if (Object.hasOwn(value, 'mailboxId')) {
    if (typeof value.mailboxId !== 'string') throw new Error('Invalid committed changes mailbox id')
    changes.mailboxId = mailboxId(value.mailboxId)
  }
  for (const key of [
    'mailboxes',
    'conversations',
    'labels',
    'drafts',
    'outbox',
    'search',
  ] as const) {
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
        !hasOnlyKeys(value, ['kind', 'id', 'method', 'error']) ||
        !Object.hasOwn(value, 'id') ||
        !Object.hasOwn(value, 'method') ||
        !Object.hasOwn(value, 'error')
      )
        throw new Error('Invalid database error message')
      if (!isPositiveSafeInteger(value.id) || !isDatabaseMethod(value.method))
        throw new Error('Invalid database error message')
      return {
        kind: 'error',
        id: value.id,
        method: value.method,
        error: parseDatabaseErrorEnvelope(value.error, 'database error envelope'),
      }
    case 'protocol-error':
      if (!hasOnlyKeys(value, ['kind', 'error']) || !Object.hasOwn(value, 'error'))
        throw new Error('Invalid database protocol error')
      return {
        kind: 'protocol-error',
        error: parseDatabaseErrorEnvelope(value.error, 'database protocol error envelope'),
      }
    case 'closed':
      if (!hasOnlyKeys(value, ['kind'])) throw new Error('Invalid database worker closed message')
      return { kind: 'closed' }
    case 'close-error':
      if (!hasOnlyKeys(value, ['kind', 'error']) || !Object.hasOwn(value, 'error'))
        throw new Error('Invalid database close error')
      return {
        kind: 'close-error',
        error: parseDatabaseErrorEnvelope(value.error, 'database close error envelope'),
      }
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
