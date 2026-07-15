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
      className="min-w-0 overflow-hidden border-e border-[#e0e4e1] bg-white"
      aria-label="Conversations"
    >
      <header className="flex h-19 items-center justify-between border-b border-[#e1e5e2] bg-white px-4.5 py-4">
        <div>
          <h1 className="truncate text-lg leading-tight text-[#202722]">Mail</h1>
          <p className="mt-1 text-xs text-[#687169]">{items.length} cached conversations</p>
        </div>
      </header>
      {query.isPending ? (
        <div className="px-4.5 py-6 text-[#5d675f]" aria-live="polite">
          Loading mail…
        </div>
      ) : query.isError ? (
        <div className="px-4.5 py-6 text-[#5d675f]" role="alert">
          Unable to load local mail.
        </div>
      ) : items.length === 0 ? (
        <div className="px-4.5 py-6 text-[#5d675f]">No conversations in this view.</div>
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
