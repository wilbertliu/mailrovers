import type { ConversationId } from '@mailrovers/mail-domain'
import type { InfiniteData } from '@tanstack/react-query'
import type { SearchPage } from '@mailrovers/mail-contracts'
import { Button } from '../../components/ui/button.js'
import { cn } from '../../lib/utils.js'

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
      <header className="flex h-19 items-center justify-between border-b border-[#e1e5e2] bg-white px-4.5 py-4">
        <div>
          <h1 className="truncate text-lg leading-tight text-[#202722]">Search</h1>
          <p className="mt-1 text-xs text-[#687169]">{items.length} loaded local results</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </header>
      {indexing ? <p className="px-4.5 py-6 text-[#5d675f]">Indexing older mail…</p> : null}
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
          <button
            type="button"
            className={cn(
              'flex w-full flex-col items-start gap-1.5 border-b border-[#e9ece9] bg-white px-4 py-3 text-start text-[#26302a] hover:bg-[#e8efea] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4d735b] focus-visible:outline-none',
              selectedConversation === hit.conversationId && 'bg-[#e8efea]',
            )}
            key={hit.messageId}
            onClick={() => onSelect(hit.conversationId)}
          >
            <strong>{hit.subject || '(No subject)'}</strong>
            <span className="max-w-full truncate text-[#59635c]">{hit.excerpt}</span>
            <small className="text-[#748078]">{hit.sender.name || hit.sender.address}</small>
          </button>
        ))}
        {items.length === 0 ? (
          <p className="px-4.5 py-6 text-[#5d675f]">No local results.</p>
        ) : null}
        {isFetchingNextPage ? (
          <p className="px-4.5 py-6 text-[#5d675f]">Loading more results…</p>
        ) : null}
        {isError ? (
          <Button type="button" variant="ghost" className="m-2" onClick={onLoadMore}>
            Retry loading results
          </Button>
        ) : null}
      </div>
    </>
  )
}
