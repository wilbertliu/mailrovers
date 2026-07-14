import type { LabelId, MailboxId, UtcTimestamp } from '@mailrovers/mail-domain'
import { useInfiniteQuery } from '@tanstack/react-query'
import { desktopBridge } from '../../desktop-bridge.js'

const MAX_PAGES = 5

export function useSearchPages(
  mailboxId: MailboxId,
  query: string,
  filters?: {
    labelId?: LabelId | undefined
    after?: UtcTimestamp | undefined
    before?: UtcTimestamp | undefined
  },
) {
  return useInfiniteQuery({
    queryKey: ['search', mailboxId, query, filters?.labelId, filters?.after, filters?.before],
    initialPageParam: undefined as string | undefined,
    enabled: query.length > 0,
    queryFn: ({ pageParam }) =>
      desktopBridge.searchMail({
        mailboxId,
        query,
        limit: 50,
        ...(filters?.labelId === undefined ? {} : { labelId: filters.labelId }),
        ...(filters?.after === undefined ? {} : { after: filters.after }),
        ...(filters?.before === undefined ? {} : { before: filters.before }),
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor,
    maxPages: MAX_PAGES,
    staleTime: 30_000,
  })
}
