import type { ConversationId, LabelId, MailboxId } from '@mailrovers/mail-domain'
import type { ReactNode } from 'react'
import { ConversationVirtualList } from './ConversationVirtualList.js'
import { ListColumnHeader } from './ListColumnHeader.js'
import { useConversationPages } from './useConversationPages.js'

export function InboxPage({
  mailbox,
  labelId,
  title,
  selectedId,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  showSidebarToggle,
  onShowSidebar,
  onSelect,
}: {
  mailbox: MailboxId
  labelId?: LabelId | undefined
  title?: ReactNode
  selectedId?: ConversationId | undefined
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearchSubmit: () => void
  showSidebarToggle?: boolean | undefined
  onShowSidebar?: (() => void) | undefined
  onSelect: (id: ConversationId) => void
}) {
  const query = useConversationPages(mailbox, labelId === undefined ? undefined : { labelId })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const unreadCount = items.filter((item) => item.unreadCount > 0).length
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
      aria-label="Conversations"
      ref={(node) => {
        const first = items[0]
        if (node !== null && selectedId === undefined && first !== undefined)
          queueMicrotask(() => onSelect(first.id))
      }}
    >
      <ListColumnHeader
        title={
          <>
            {title ?? 'Inbox'}{' '}
            <span className="text-sm font-normal text-muted-foreground">{unreadCount}</span>
          </>
        }
        searchInput={searchInput}
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
        showSidebarToggle={showSidebarToggle}
        onShowSidebar={onShowSidebar}
      />
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-4 text-sm text-muted-foreground">
        <span>{items.length} conversations</span>
        <span>Newest</span>
      </div>
      {query.isPending ? (
        <div className="px-4 py-6 text-sm" aria-live="polite">
          Loading mail…
        </div>
      ) : query.isError ? (
        <div className="px-4 py-6 text-sm" role="alert">
          Unable to load local mail.
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-6 text-sm">No conversations in this view.</div>
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
