import type { LabelId, MailboxId } from '@mailrovers/mail-domain'
import { useInfiniteQuery } from '@tanstack/react-query'
import { desktopBridge } from '../../desktop-bridge.js'

const MAX_PAGES = 5
export function useConversationPages(
  mailbox: MailboxId,
  filter?: { labelId?: LabelId | undefined; unreadOnly?: boolean | undefined },
) {
  return useInfiniteQuery({
    queryKey: ['conversations', mailbox, filter?.labelId, filter?.unreadOnly],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      desktopBridge.listConversations({
        requestId: desktopBridge.createRequestId(),
        mailboxId: mailbox,
        limit: 50,
        ...(filter?.labelId === undefined ? {} : { labelId: filter.labelId }),
        ...(filter?.unreadOnly === undefined ? {} : { unreadOnly: filter.unreadOnly }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor,
    maxPages: MAX_PAGES,
    staleTime: 60_000,
  })
}
