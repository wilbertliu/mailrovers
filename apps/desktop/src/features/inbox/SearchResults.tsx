import type { ConversationId } from '@mailrovers/mail-domain'
import type { InfiniteData } from '@tanstack/react-query'
import type { SearchPage } from '@mailrovers/mail-contracts'
import { Button } from '@/components/ui/button.js'

export function SearchResults({
  pages,
  selectedConversation,
  hasNextPage,
  isFetchingNextPage,
  isError,
  onClear,
  onLoadMore,
  onSelect,
}: {
  pages: InfiniteData<SearchPage> | undefined
  selectedConversation?: ConversationId | undefined
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isError: boolean
  onClear: () => void
  onLoadMore: () => void
  onSelect: (conversationId: ConversationId) => void
}) {
  const items = pages?.pages.flatMap((page) => page.items) ?? []
  const indexing = pages?.pages.some((page) => page.indexing) ?? false
  return (
    <>
      <header className="flex h-20 items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="truncate text-lg tracking-tight">Search</h1>
          <p className="mt-1 text-xs text-muted-foreground">{items.length} loaded local results</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </header>
      {indexing ? <p className="px-4.5 py-6">Indexing older mail…</p> : null}
      <div
        className="h-[calc(100vh-132px)] overflow-y-auto"
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
            className="flex w-full flex-col items-start gap-1.5 rounded-md px-4 py-3 text-start aria-pressed:bg-accent"
            aria-pressed={selectedConversation === hit.conversationId}
            key={hit.messageId}
            onClick={() => onSelect(hit.conversationId)}
          >
            <strong>{hit.subject || '(No subject)'}</strong>
            <span className="max-w-full truncate text-muted-foreground">{hit.excerpt}</span>
            <small className="text-muted-foreground">{hit.sender.name || hit.sender.address}</small>
          </Button>
        ))}
        {items.length === 0 ? <p className="px-4.5 py-6">No local results.</p> : null}
        {isFetchingNextPage ? <p className="px-4.5 py-6">Loading more results…</p> : null}
        {isError ? (
          <Button type="button" variant="ghost" className="m-2" onClick={onLoadMore}>
            Retry loading results
          </Button>
        ) : null}
      </div>
    </>
  )
}
