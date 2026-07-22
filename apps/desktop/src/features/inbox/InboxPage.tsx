import type { ConversationId, LabelId, MailboxId } from '@mailrovers/mail-domain'
import type { ReactNode } from 'react'
import { ConversationVirtualList } from './ConversationVirtualList.js'
import { ListColumnHeader } from './ListColumnHeader.js'
import { useConversationPages } from './useConversationPages.js'

export function InboxPage({
  mailbox,
  labelId,
  title,
  unreadCount = 0,
  selectedId,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  showSidebarToggle,
  onShowSidebar,
  importInProgress,
  onSelect,
}: {
  mailbox: MailboxId
  labelId?: LabelId | undefined
  title?: ReactNode
  unreadCount?: number | undefined
  selectedId?: ConversationId | undefined
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearchSubmit: (value: string) => void
  showSidebarToggle?: boolean | undefined
  onShowSidebar?: (() => void) | undefined
  importInProgress?: boolean | undefined
  onSelect: (id: ConversationId) => void
}) {
  const query = useConversationPages(mailbox, labelId === undefined ? undefined : { labelId })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
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
            {title ?? 'Inbox'}
            {unreadCount > 0 ? (
              <>
                {' '}
                <span className="text-xs font-normal text-muted-foreground">{unreadCount}</span>
              </>
            ) : null}
          </>
        }
        searchInput={searchInput}
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
        showSidebarToggle={showSidebarToggle}
        onShowSidebar={onShowSidebar}
        importInProgress={importInProgress}
      />
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
