import type { MailboxId } from '@mailrovers/mail-domain';
import { useInfiniteQuery } from '@tanstack/react-query';
import { desktopBridge } from '../../desktop-bridge.js';

const MAX_PAGES = 5;
export function useConversationPages(mailbox: MailboxId) {
  return useInfiniteQuery({
    queryKey: ['conversations', mailbox],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => desktopBridge.listConversations({ mailboxId: mailbox, limit: 50, ...(pageParam === undefined ? {} : { cursor: pageParam }) }),
    getNextPageParam: (page) => page.nextCursor,
    maxPages: MAX_PAGES,
    staleTime: 60_000,
  });
}
