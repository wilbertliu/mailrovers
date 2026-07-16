import { useEffect } from 'react'
import { toast } from 'sonner'

export function useMailboxRefreshErrorToast({
  hasCachedData,
  isError,
  errorUpdatedAt,
}: {
  hasCachedData: boolean
  isError: boolean
  errorUpdatedAt: number
}) {
  useEffect(() => {
    if (!isError || !hasCachedData) return
    toast.error("Couldn't refresh mailboxes", {
      id: 'mailboxes-refresh-error',
      description: 'Showing the last available mailbox data.',
    })
  }, [errorUpdatedAt, hasCachedData, isError])
}
