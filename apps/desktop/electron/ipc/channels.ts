export const channels = {
  listConversations: 'mailrovers:v1:list-conversations',
  listMailboxes: 'mailrovers:v1:list-mailboxes',
  connectGmail: 'mailrovers:v1:connect-gmail',
  disconnectMailbox: 'mailrovers:v1:disconnect-mailbox',
  startSync: 'mailrovers:v1:start-sync',
  getSyncStatus: 'mailrovers:v1:get-sync-status',
  cancelOperation: 'mailrovers:v1:cancel-operation',
  event: 'mailrovers:v1:event',
} as const
