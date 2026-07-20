import type { ConversationId, LabelId, MailboxId } from '@mailrovers/mail-domain'
import { ConversationVirtualList } from './ConversationVirtualList.js'
import { useConversationPages } from './useConversationPages.js'

export function InboxPage({
  mailbox,
  labelId,
  selectedId,
  onSelect,
}: {
  mailbox: MailboxId
  labelId?: LabelId | undefined
  selectedId?: ConversationId | undefined
  onSelect: (id: ConversationId) => void
}) {
  const query = useConversationPages(mailbox, labelId === undefined ? undefined : { labelId })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <section
      className="min-w-0 overflow-hidden border-r bg-background"
      aria-label="Conversations"
      ref={(node) => {
        const first = items[0]
        if (node !== null && selectedId === undefined && first !== undefined)
          queueMicrotask(() => onSelect(first.id))
      }}
    >
      <header className="window-titlebar flex h-20 items-center justify-between px-4 py-3">
        <div>
          <p className="mb-1 text-[0.625rem] text-muted-foreground">Workspace</p>
          <h1 className="truncate text-lg tracking-tight">
            Inbox{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {items.filter((item) => item.unreadCount > 0).length}
            </span>
          </h1>
        </div>
      </header>
      <div className="flex h-8 items-center justify-between border-y px-4 text-[0.625rem] text-muted-foreground">
        <span>{items.length} conversations</span>
        <span>Newest⌄</span>
      </div>
      {query.isPending ? (
        <div className="px-4.5 py-6" aria-live="polite">
          Loading mail…
        </div>
      ) : query.isError ? (
        <div className="px-4.5 py-6" role="alert">
          Unable to load local mail.
        </div>
      ) : items.length === 0 ? (
        <div className="px-4.5 py-6">No conversations in this view.</div>
      ) : (
        <ConversationVirtualList
          items={items}
          selectedId={selectedId}
          onSelect={(item) => onSelect(item.id)}
          onEnd={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
          }}
        />
      )}
    </section>
  )
}
