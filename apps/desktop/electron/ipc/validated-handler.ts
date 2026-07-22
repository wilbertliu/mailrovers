import type { ApplicationError } from '@mailrovers/mail-contracts'
import { stableErrorCode, type StableErrorCode } from '@mailrovers/platform-electron'
import {
  isAuthorizedRequest,
  type AuthorizationEvent,
  type AuthorizedWebContents,
} from './authorization.js'

export type IpcMainLike = {
  handle(channel: string, listener: (event: AuthorizationEvent, input: unknown) => unknown): void
  removeHandler(channel: string): void
}

type SafeParseResult<Output> = { success: true; data: Output } | { success: false }

type SchemaOutput<Schema> = Schema extends { readonly _output: infer Output } ? Output : never

type RuntimeSchema<Schema> = {
  readonly _output: unknown
  safeParse(value: unknown): SafeParseResult<SchemaOutput<Schema>>
}

type HandlerRegistrationContext<Application> = {
  ipcMain: IpcMainLike
  application: Application
  webContents: AuthorizedWebContents
  rendererUrl: string
}

export type ValidatedHandlerDefinition<
  Application,
  InputSchema extends RuntimeSchema<InputSchema>,
  ResultSchema extends RuntimeSchema<ResultSchema>,
> = {
  channel: string
  inputSchema: InputSchema
  resultSchema: ResultSchema
  run(application: Application, value: SchemaOutput<InputSchema>): Promise<unknown>
}

type RegisteredValidatedHandler<
  Application,
  InputSchema extends RuntimeSchema<InputSchema>,
  ResultSchema extends RuntimeSchema<ResultSchema>,
> = ValidatedHandlerDefinition<Application, InputSchema, ResultSchema> & {
  register(input: HandlerRegistrationContext<Application>): () => void
}

type HandlerRegistration<Application> = {
  register(input: HandlerRegistrationContext<Application>): () => void
}

function requestId(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    value.requestId.length <= 200
  )
    return value.requestId
  return 'unknown-request'
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

export function safeApplicationError(error: unknown, id: string): ApplicationError {
  if (error instanceof Error && error.name === 'AbortError')
    return applicationError(
      'OPERATION_CANCELLED',
      'The operation was cancelled.',
      true,
      id,
      'retry',
    )
  if (error instanceof Error && error.message === 'DRAFT_VERSION_CONFLICT')
    return applicationError(
      'DRAFT_VERSION_CONFLICT',
      'This draft changed in another window. Reload it before saving again.',
      true,
      id,
      'retry',
    )
  const code = stableErrorCode(errorCode(error), 'APPLICATION_ERROR')
  if (code === 'AI_CONTEXT_STALE' || code === 'AI_ARTIFACT_STALE')
    return applicationError(
      code,
      'The conversation or draft changed. Generate a new suggestion.',
      true,
      id,
      'retry',
    )
  if (code === 'AI_CONFIGURATION_INVALID' || code === 'AI_AUTHENTICATION_FAILED')
    return applicationError(
      code,
      'Review the AI provider settings and API key.',
      false,
      id,
      'reviewSettings',
    )
  if (
    code === 'AI_PROVIDER_THROTTLED' ||
    code === 'AI_PROVIDER_UNAVAILABLE' ||
    code === 'AI_RESPONSE_INVALID' ||
    code === 'AI_UNSAFE_OUTPUT'
  )
    return applicationError(
      code,
      'The AI provider could not complete the request.',
      code !== 'AI_UNSAFE_OUTPUT',
      id,
      code === 'AI_UNSAFE_OUTPUT' ? undefined : 'retry',
    )
  if (error instanceof Error && error.message.includes('client ID is not configured'))
    return applicationError(
      'GMAIL_CONFIGURATION_REQUIRED',
      "Google sign-in isn't configured",
      false,
      id,
      'reviewSettings',
    )
  if (error instanceof Error && error.message === 'Google OAuth client secret is required')
    return applicationError(
      'GMAIL_CONFIGURATION_REQUIRED',
      'Google OAuth client secret is required. Set MAILROVERS_GOOGLE_OAUTH_CLIENT_SECRET from the Desktop app client in Google Cloud Console.',
      false,
      id,
      'reviewSettings',
    )
  if (code === 'SECRET_STORAGE_UNAVAILABLE')
    return applicationError(
      'SECRET_STORAGE_UNAVAILABLE',
      error instanceof Error
        ? error.message
        : 'Operating-system credential encryption is unavailable.',
      false,
      id,
      'reviewSettings',
    )
  return applicationError(
    'APPLICATION_ERROR',
    'MailRovers could not complete the request.',
    true,
    id,
    'retry',
  )
}

function applicationError(
  code: StableErrorCode,
  message: string,
  retryable: boolean,
  requestIdValue: string,
  userAction?: ApplicationError['userAction'],
): ApplicationError {
  return {
    code,
    message,
    retryable,
    requestId: requestIdValue,
    ...(userAction === undefined ? {} : { userAction }),
  }
}

function failure(
  code: StableErrorCode,
  message: string,
  id: string,
): { ok: false; error: ApplicationError } {
  return { ok: false, error: applicationError(code, message, false, id) }
}

/** Registers one authorized, schema-validated invoke handler and returns an idempotent unregister. */
export function registerValidatedHandler<
  Application,
  InputSchema extends RuntimeSchema<InputSchema>,
  ResultSchema extends RuntimeSchema<ResultSchema>,
>(input: {
  ipcMain: IpcMainLike
  definition: ValidatedHandlerDefinition<Application, InputSchema, ResultSchema>
  application: Application
  webContents: AuthorizedWebContents
  rendererUrl: string
}): () => void {
  const { definition } = input
  const configurationProbe = definition.resultSchema.safeParse(
    failure('INTERNAL_ERROR', 'MailRovers could not complete the request.', 'unknown-request'),
  )
  if (!configurationProbe.success) throw new Error('Invalid IPC result schema')

  input.ipcMain.removeHandler(definition.channel)
  input.ipcMain.handle(definition.channel, async (event, unknownInput) => {
    const id = requestId(unknownInput)
    const respond = (
      candidate: unknown,
      invalidMessage = 'MailRovers returned an invalid response.',
    ) => {
      const parsed = definition.resultSchema.safeParse(candidate)
      if (parsed.success) return parsed.data
      const fallback = definition.resultSchema.safeParse(
        failure('INVALID_RESPONSE', invalidMessage, id),
      )
      if (fallback.success) return fallback.data
      return configurationProbe.data
    }

    if (!isAuthorizedRequest(event, input.webContents, input.rendererUrl))
      return respond(failure('UNAUTHORIZED_REQUEST', 'The request was not authorized.', id))
    const parsedInput = definition.inputSchema.safeParse(unknownInput)
    if (!parsedInput.success)
      return respond(failure('INVALID_REQUEST', 'The request was invalid.', id))
    try {
      const value = await definition.run(input.application, parsedInput.data)
      return respond({ ok: true, value })
    } catch (error) {
      return respond({ ok: false, error: safeApplicationError(error, id) })
    }
  })

  let registered = true
  return () => {
    if (!registered) return
    registered = false
    input.ipcMain.removeHandler(definition.channel)
  }
}

export function defineValidatedHandler<Application>() {
  return <
    InputSchema extends RuntimeSchema<InputSchema>,
    ResultSchema extends RuntimeSchema<ResultSchema>,
  >(
    definition: ValidatedHandlerDefinition<Application, InputSchema, ResultSchema>,
  ): RegisteredValidatedHandler<Application, InputSchema, ResultSchema> => ({
    ...definition,
    register: (input) => registerValidatedHandler({ ...input, definition }),
  })
}

export function registerValidatedRegistry<Application>(
  input: {
    definitions: readonly HandlerRegistration<Application>[]
  } & HandlerRegistrationContext<Application>,
): () => void {
  const unregister = input.definitions.map((definition) => definition.register(input))
  let registered = true
  return () => {
    if (!registered) return
    registered = false
    for (const remove of [...unregister].reverse()) remove()
  }
}
