import type { MailboxId } from '@mailrovers/mail-domain'
import { ConversationVirtualList } from './ConversationVirtualList.js'
import { useConversationPages } from './useConversationPages.js'

export function InboxPage({ mailbox }: { mailbox: MailboxId }) {
  const query = useConversationPages(mailbox)
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <main>
      <header>
        <h1>MailRovers</h1>
        <p>{items.length} cached conversations</p>
      </header>
      {query.isError ? (
        <p role="alert">Unable to load local inbox.</p>
      ) : (
        <ConversationVirtualList
          items={items}
          onEnd={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
          }}
        />
      )}
    </main>
  )
}
