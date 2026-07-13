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
    <section className="conversation-list-panel" aria-label="Conversations">
      <header className="list-header">
        <div>
          <h1>Mail</h1>
          <p>{items.length} cached conversations</p>
        </div>
      </header>
      {query.isPending ? (
        <div className="list-state" aria-live="polite">
          Loading mail…
        </div>
      ) : query.isError ? (
        <div className="list-state" role="alert">
          Unable to load local mail.
        </div>
      ) : items.length === 0 ? (
        <div className="list-state">No conversations in this view.</div>
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
