import {
  QueryCache,
  QueryClient,
  type QueryClientConfig,
  type QueryKey,
} from '@tanstack/react-query'
import { toast } from 'sonner'

type DesktopQueryClientOptions = {
  config?: Omit<QueryClientConfig, 'queryCache'> | undefined
  notifyMailboxRefreshError?: (() => void) | undefined
}

function isMailboxQuery(queryKey: QueryKey): boolean {
  return queryKey.length === 1 && queryKey[0] === 'mailboxes'
}

function showMailboxRefreshError(): void {
  toast.error("Couldn't refresh mailboxes", {
    id: 'mailboxes-refresh-error',
    description: 'Showing the last available mailbox data.',
  })
}

export function createDesktopQueryClient({
  config,
  notifyMailboxRefreshError = showMailboxRefreshError,
}: DesktopQueryClientOptions = {}): QueryClient {
  const queryCache = new QueryCache({
    onError: (_error, query) => {
      if (isMailboxQuery(query.queryKey) && query.state.data !== undefined)
        notifyMailboxRefreshError()
    },
  })

  return new QueryClient({ ...config, queryCache })
}
