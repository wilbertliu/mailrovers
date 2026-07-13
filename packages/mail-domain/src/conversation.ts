export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }
export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type MailboxId = Brand<string, 'MailboxId'>
export type ConversationId = Brand<string, 'ConversationId'>
export type UtcTimestamp = Brand<string, 'UtcTimestamp'>

function opaque<Name extends string>(value: string, name: Name): Brand<string, Name> {
  if (value.length === 0) throw new Error(`${name} must not be empty`)
  return value as Brand<string, Name>
}
export const workspaceId = (value: string): WorkspaceId => opaque(value, 'WorkspaceId')
export const mailboxId = (value: string): MailboxId => opaque(value, 'MailboxId')
export const conversationId = (value: string): ConversationId => opaque(value, 'ConversationId')
export const utcTimestamp = (value: string): UtcTimestamp => {
  if (Number.isNaN(Date.parse(value))) throw new Error('UtcTimestamp must be ISO-8601')
  return opaque(value, 'UtcTimestamp')
}
