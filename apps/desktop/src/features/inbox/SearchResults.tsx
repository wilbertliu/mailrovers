import type { ConversationId } from '@mailrovers/mail-domain'
import type { InfiniteData } from '@tanstack/react-query'
import type { SearchPage } from '@mailrovers/mail-contracts'

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
      <header className="list-header">
        <div>
          <h1>Search</h1>
          <p>{items.length} loaded local results</p>
        </div>
        <button type="button" className="text-button" onClick={onClear}>
          Clear
        </button>
      </header>
      {indexing ? <p className="indexing-note">Indexing older mail…</p> : null}
      <div
        className="search-results"
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
            className={
              selectedConversation === hit.conversationId
                ? 'search-result selected'
                : 'search-result'
            }
            key={hit.messageId}
            onClick={() => onSelect(hit.conversationId)}
          >
            <strong>{hit.subject || '(No subject)'}</strong>
            <span>{hit.excerpt}</span>
            <small>{hit.sender.name || hit.sender.address}</small>
          </button>
        ))}
        {items.length === 0 ? <p className="list-state">No local results.</p> : null}
        {isFetchingNextPage ? <p className="list-state">Loading more results…</p> : null}
        {isError ? (
          <button type="button" className="text-button" onClick={onLoadMore}>
            Retry loading results
          </button>
        ) : null}
      </div>
    </>
  )
}
