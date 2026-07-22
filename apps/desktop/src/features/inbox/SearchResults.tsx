import type { ConversationId } from '@mailrovers/mail-domain'
import type { InfiniteData } from '@tanstack/react-query'
import type { MailboxSummary, SearchPage } from '@mailrovers/mail-contracts'
import { Button } from '@/components/ui/button.js'
import { ListColumnHeader } from './ListColumnHeader.js'

export function SearchResults({
  pages,
  selectedConversation,
  hasNextPage,
  isFetchingNextPage,
  isError,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  onClear,
  onLoadMore,
  onSelect,
  showSidebarToggle,
  onShowSidebar,
  importMailbox,
}: {
  pages: InfiniteData<SearchPage> | undefined
  selectedConversation?: ConversationId | undefined
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isError: boolean
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearchSubmit: (value: string) => void
  onClear: () => void
  onLoadMore: () => void
  onSelect: (conversationId: ConversationId) => void
  showSidebarToggle?: boolean | undefined
  onShowSidebar?: (() => void) | undefined
  importMailbox?: MailboxSummary | undefined
}) {
  const items = pages?.pages.flatMap((page) => page.items) ?? []
  const indexing = pages?.pages.some((page) => page.indexing) ?? false
  return (
    <>
      <ListColumnHeader
        title="Search"
        subtitle={`${items.length} loaded local results`}
        searchInput={searchInput}
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
        showSidebarToggle={showSidebarToggle}
        onShowSidebar={onShowSidebar}
        importMailbox={importMailbox}
        trailing={
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        }
      />
      {indexing ? <p className="px-4 py-6 text-sm">Indexing older mail…</p> : null}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget
          if (
            hasNextPage &&
            !isFetchingNextPage &&
            element.scrollTop + element.clientHeight >= element.scrollHeight - 256
          )
            onLoadMore()
        }}
      >
        {items.map((hit) => (
          <Button
            type="button"
            variant="ghost"
            className="flex w-full flex-col items-start gap-1.5 rounded-md px-4 py-3 text-start text-sm aria-pressed:bg-accent"
            aria-pressed={selectedConversation === hit.conversationId}
            key={hit.messageId}
            onClick={() => onSelect(hit.conversationId)}
          >
            <strong className="text-sm font-medium">{hit.subject || '(No subject)'}</strong>
            <span className="max-w-full truncate text-sm text-muted-foreground">{hit.excerpt}</span>
            <small className="text-sm text-muted-foreground">
              {hit.sender.name || hit.sender.address}
            </small>
          </Button>
        ))}
        {items.length === 0 ? <p className="px-4 py-6 text-sm">No local results.</p> : null}
        {isFetchingNextPage ? <p className="px-4 py-6 text-sm">Loading more results…</p> : null}
        {isError ? (
          <Button type="button" variant="ghost" className="m-2 text-sm" onClick={onLoadMore}>
            Retry loading results
          </Button>
        ) : null}
      </div>
    </>
  )
}
