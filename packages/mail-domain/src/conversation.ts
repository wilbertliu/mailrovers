export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }
export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type MailboxId = Brand<string, 'MailboxId'>
export type ConversationId = Brand<string, 'ConversationId'>
export type MessageId = Brand<string, 'MessageId'>
export type LabelId = Brand<string, 'LabelId'>
export type DraftId = Brand<string, 'DraftId'>
export type AttachmentId = Brand<string, 'AttachmentId'>
export type OperationId = Brand<string, 'OperationId'>
export type CommandId = Brand<string, 'CommandId'>
export type UtcTimestamp = Brand<string, 'UtcTimestamp'>

function opaque<Name extends string>(value: string, name: Name): Brand<string, Name> {
  if (value.length === 0) throw new Error(`${name} must not be empty`)
  return value as Brand<string, Name>
}
export const workspaceId = (value: string): WorkspaceId => opaque(value, 'WorkspaceId')
export const mailboxId = (value: string): MailboxId => opaque(value, 'MailboxId')
export const conversationId = (value: string): ConversationId => opaque(value, 'ConversationId')
export const messageId = (value: string): MessageId => opaque(value, 'MessageId')
export const labelId = (value: string): LabelId => opaque(value, 'LabelId')
export const draftId = (value: string): DraftId => opaque(value, 'DraftId')
export const attachmentId = (value: string): AttachmentId => opaque(value, 'AttachmentId')
export const operationId = (value: string): OperationId => opaque(value, 'OperationId')
export const commandId = (value: string): CommandId => opaque(value, 'CommandId')
export const utcTimestamp = (value: string): UtcTimestamp => {
  if (Number.isNaN(Date.parse(value))) throw new Error('UtcTimestamp must be ISO-8601')
  return opaque(value, 'UtcTimestamp')
}
