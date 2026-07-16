import type { DesktopEvent, MailboxSummary, SyncStatus } from '@mailrovers/mail-contracts'
import type { MailboxId, OperationId } from '@mailrovers/mail-domain'
import { Alert02Icon, BrowserIcon, ComputerProtectionIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button.js'
import { NativeSelect } from '@/components/ui/native-select.js'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.js'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '@/components/ui/empty.js'
import { FieldError } from '@/components/ui/field.js'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item.js'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker.js'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress.js'
import { Spinner } from '@/components/ui/spinner.js'
import { useImportSubscription } from '@/hooks/use-import-subscription.js'
import { useMailboxRefreshErrorToast } from '@/hooks/use-mailbox-refresh-error-toast.js'
import { DesktopApplicationError, desktopBridge } from '../../desktop-bridge.js'
import { MailWorkspace } from './MailWorkspace.js'

function WindowFrame({ children, titlebar }: { children: ReactNode; titlebar?: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="window-titlebar flex h-14 shrink-0 items-center py-2 pr-4 pl-22">
        {titlebar}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function LoadingPage({ message }: { message: string }) {
  return (
    <main className="grid h-full place-items-center p-6">
      <Marker className="w-auto" render={<output aria-live="polite" />}>
        <MarkerIcon>
          <Spinner aria-hidden="true" />
        </MarkerIcon>
        <MarkerContent>{message}</MarkerContent>
      </Marker>
    </main>
  )
}

function MailboxErrorPage({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <main className="grid h-full place-items-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyDescription role="alert">Couldn't open your local mailbox.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" onClick={onRetry} disabled={retrying}>
            {retrying ? <Spinner data-icon="inline-start" /> : null}
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}

type ConnectPendingAction = 'connect' | 'cancel'

function ConnectActions({
  pendingAction,
  onConnect,
  onCancel,
  onBack,
}: {
  pendingAction: ConnectPendingAction | undefined
  onConnect: () => void
  onCancel: () => void
  onBack?: (() => void) | undefined
}) {
  const connecting = pendingAction !== undefined

  return (
    <>
      <Button type="button" onClick={onConnect} disabled={connecting}>
        {pendingAction === 'connect' ? <Spinner data-icon="inline-start" /> : null}
        {pendingAction === 'connect' ? 'Waiting for Google…' : 'Connect Gmail'}
      </Button>
      {connecting ? (
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={pendingAction === 'cancel'}
        >
          {pendingAction === 'cancel' ? <Spinner data-icon="inline-start" /> : null}
          {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
        </Button>
      ) : onBack ? (
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
      ) : null}
    </>
  )
}

function ConnectPage({
  onConnected,
  onCancel,
}: {
  onConnected: (mailboxId: MailboxId) => Promise<void>
  onCancel?: (() => void) | undefined
}) {
  const [pendingAction, setPendingAction] = useState<ConnectPendingAction>()
  const [operation, setOperation] = useState<OperationId>()

  const connect = async () => {
    const requestId = desktopBridge.createRequestId()
    setOperation(requestId)
    setPendingAction('connect')
    try {
      const result = await desktopBridge.connectGmail({ requestId })
      await onConnected(result.mailbox.id)
    } catch (caught) {
      const cancelled =
        caught instanceof DesktopApplicationError && caught.detail.code === 'OPERATION_CANCELLED'
      if (!cancelled)
        toast.error(caught instanceof Error ? caught.message : 'Gmail connection failed.', {
          id: 'gmail-connect-error',
        })
    } finally {
      setPendingAction(undefined)
      setOperation(undefined)
    }
  }

  const cancel = async () => {
    if (!operation) return
    setPendingAction('cancel')
    try {
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: operation,
      })
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to cancel Gmail connection.', {
        id: 'gmail-cancel-error',
      })
      setPendingAction('connect')
    }
  }

  const actions = (
    <ConnectActions
      pendingAction={pendingAction}
      onConnect={() => void connect()}
      onCancel={() => void cancel()}
      {...(onCancel ? { onBack: onCancel } : {})}
    />
  )

  return (
    <main className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1 className="text-balance">Before you connect</h1>
          </CardTitle>
          <CardDescription className="text-pretty">
            MailRovers connects directly to Gmail and keeps your imported mail on this Mac.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ItemGroup>
            <Item variant="muted" size="sm">
              <ItemMedia variant="icon">
                <HugeiconsIcon icon={ComputerProtectionIcon} strokeWidth={2} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Stored on this Mac</ItemTitle>
                <ItemDescription>
                  Imported messages live in MailRovers' local database.
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="muted" size="sm">
              <ItemMedia variant="icon">
                <HugeiconsIcon icon={BrowserIcon} strokeWidth={2} />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Google handles sign-in</ItemTitle>
                <ItemDescription>Authorization opens in your default browser.</ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">{actions}</CardFooter>
      </Card>
    </main>
  )
}

function progressLabel(status: SyncStatus | undefined, mailbox: MailboxSummary): string {
  const phase = status?.phase ?? mailbox.syncState
  switch (phase) {
    case 'importing_labels':
      return 'Importing labels'
    case 'importing_messages':
    case 'importing':
      return 'Importing messages'
    case 'importing_drafts':
      return 'Importing drafts'
    case 'reconciling_history':
    case 'full_reconciliation':
    case 'reconciling':
      return 'Checking for changes during import'
    case 'paused':
      return 'Import paused'
    case 'failed':
      return 'Import needs attention'
    case 'auth_required':
      return 'Gmail needs to be connected again'
    case 'complete':
    case 'ready':
      return 'Import complete'
    case 'authenticating':
      return 'Connecting Gmail'
    case 'idle':
      return 'Preparing import'
  }
}

function ImportPage({
  mailbox,
  onChanged,
}: {
  mailbox: MailboxSummary
  onChanged: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [operation, setOperation] = useState<OperationId>()
  const [error, setError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'disconnect'>()
  const statusQueryKey = ['sync-status', mailbox.id]
  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: () =>
      desktopBridge.getSyncStatus({
        requestId: desktopBridge.createRequestId(),
        mailboxId: mailbox.id,
      }),
  })
  const status = statusQuery.data

  const refreshStatus = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['sync-status', mailbox.id] })
  }, [mailbox.id, queryClient])

  const handleEvent = useCallback(
    (event: DesktopEvent) => {
      switch (event.kind) {
        case 'sync-failed':
          setError(event.error.message)
          void onChanged()
          break
        case 'sync-progress':
          queryClient.setQueryData(['sync-status', mailbox.id], event.status)
          break
        case 'sync-completed':
        case 'sync-cancelled':
          queryClient.setQueryData(['sync-status', mailbox.id], event.status)
          void onChanged()
          break
        case 'events-overflowed':
          void refreshStatus()
          void onChanged()
          break
      }
    },
    [mailbox.id, onChanged, queryClient, refreshStatus],
  )

  const start = useCallback(async () => {
    const requestId = desktopBridge.createRequestId()
    const receipt = await desktopBridge.startSync({ requestId, mailboxId: mailbox.id })
    setOperation(receipt.requestId)
    return receipt.requestId
  }, [mailbox.id])

  const subscribe = useCallback(
    (operationId: OperationId) => desktopBridge.subscribe(operationId, handleEvent),
    [handleEvent],
  )
  useImportSubscription({ syncState: mailbox.syncState, start, subscribe, onError: setError })

  const pause = async () => {
    setPendingAction('pause')
    setError(undefined)
    try {
      const activeOperation = operation ?? (await start())
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: activeOperation,
      })
      await refreshStatus()
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to pause the import.')
    } finally {
      setPendingAction(undefined)
    }
  }

  const resume = async () => {
    setPendingAction('resume')
    setError(undefined)
    try {
      const requestId = await start()
      desktopBridge.subscribe(requestId, handleEvent)
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to resume the import.')
    } finally {
      setPendingAction(undefined)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect Gmail and remove its local MailRovers data?')) return
    setPendingAction('disconnect')
    setError(undefined)
    try {
      if (operation)
        await desktopBridge.cancelOperation({
          requestId: desktopBridge.createRequestId(),
          operationId: operation,
        })
      await desktopBridge.disconnectMailbox({
        requestId: desktopBridge.createRequestId(),
        mailboxId: mailbox.id,
        removeLocalData: true,
      })
      await onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to disconnect Gmail.')
    } finally {
      setPendingAction(undefined)
    }
  }

  const imported = status?.importedMessageCount ?? mailbox.importedMessageCount
  const total = status?.totalEstimate ?? mailbox.importTotalEstimate
  const progress = total && total > 0 ? Math.min(100, (imported / total) * 100) : undefined
  const paused = status?.phase === 'paused' || mailbox.syncState === 'paused'
  const failed = status?.phase === 'failed' || mailbox.syncState === 'failed'

  return (
    <main className="grid h-full place-items-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="truncate">{mailbox.emailAddress}</p>
          <CardTitle>
            <h1 className="text-balance">{progressLabel(status, mailbox)}</h1>
          </CardTitle>
          <CardDescription className="text-pretty">
            {imported.toLocaleString()} messages imported
            {total === undefined ? '' : ` of about ${total.toLocaleString()}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Progress value={progress ?? null} aria-label="Gmail import progress">
            <ProgressLabel>Import progress</ProgressLabel>
            <ProgressValue>
              {(_formattedValue, value) =>
                value === null ? 'Estimating…' : `${Math.round(value)}%`
              }
            </ProgressValue>
          </Progress>
          {error || statusQuery.error ? (
            <FieldError>
              {error ??
                (statusQuery.error instanceof Error
                  ? statusQuery.error.message
                  : 'Unable to load import status.')}
            </FieldError>
          ) : null}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          {paused || failed ? (
            <Button
              type="button"
              onClick={() => void resume()}
              disabled={pendingAction !== undefined}
            >
              {pendingAction === 'resume' ? <Spinner data-icon="inline-start" /> : null}
              {pendingAction === 'resume'
                ? failed
                  ? 'Retrying…'
                  : 'Resuming…'
                : failed
                  ? 'Retry import'
                  : 'Resume import'}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void pause()}
              disabled={pendingAction !== undefined}
            >
              {pendingAction === 'pause' ? <Spinner data-icon="inline-start" /> : null}
              {pendingAction === 'pause' ? 'Pausing…' : 'Pause import'}
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            onClick={() => void disconnect()}
            disabled={pendingAction !== undefined}
          >
            {pendingAction === 'disconnect' ? <Spinner data-icon="inline-start" /> : null}
            {pendingAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </Button>
          <p className="basis-full pt-3">
            You can close MailRovers. The import resumes when you reopen it.
          </p>
        </CardFooter>
      </Card>
    </main>
  )
}

export function MailboxGate() {
  const queryClient = useQueryClient()
  const [selectedMailbox, setSelectedMailbox] = useState<MailboxId>()
  const [showConnect, setShowConnect] = useState(false)
  const [retryingInitialLoad, setRetryingInitialLoad] = useState(false)
  const mailboxes = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => desktopBridge.listMailboxes(desktopBridge.createRequestId()),
    staleTime: 2_000,
  })
  const onChanged = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
  }, [queryClient])
  const onConnected = useCallback(
    async (mailboxId: MailboxId) => {
      setSelectedMailbox(mailboxId)
      setShowConnect(false)
      await onChanged()
    },
    [onChanged],
  )
  useMailboxRefreshErrorToast({
    hasCachedData: mailboxes.data !== undefined,
    isError: mailboxes.isError,
    errorUpdatedAt: mailboxes.errorUpdatedAt,
  })

  const retryInitialLoad = async () => {
    setRetryingInitialLoad(true)
    try {
      await mailboxes.refetch()
    } finally {
      setRetryingInitialLoad(false)
    }
  }

  let content: ReactNode
  let titlebar: ReactNode

  if (mailboxes.data === undefined && (mailboxes.isError || retryingInitialLoad)) {
    content = (
      <MailboxErrorPage retrying={retryingInitialLoad} onRetry={() => void retryInitialLoad()} />
    )
  } else if (mailboxes.data === undefined) {
    content = <LoadingPage message="Opening your local mailbox…" />
  } else {
    const mailbox = mailboxes.data.find((item) => item.id === selectedMailbox) ?? mailboxes.data[0]
    if (!mailbox || showConnect) {
      content = (
        <ConnectPage
          onConnected={onConnected}
          {...(mailbox ? { onCancel: () => setShowConnect(false) } : {})}
        />
      )
    } else if (mailbox.connectionState === 'connected' && mailbox.syncState !== 'ready') {
      content = <ImportPage mailbox={mailbox} onChanged={onChanged} />
    } else {
      titlebar = (
        <nav className="flex w-full items-center justify-between" aria-label="Mailboxes">
          <label className="flex items-center gap-2.5">
            <span>Mailbox</span>
            <NativeSelect
              className="min-w-55 py-1.5 pr-7 pl-2.5"
              value={mailbox.id}
              onChange={(event) =>
                setSelectedMailbox(mailboxes.data[event.target.selectedIndex]?.id)
              }
            >
              {mailboxes.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.emailAddress}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowConnect(true)}>
            Add Gmail account
          </Button>
        </nav>
      )
      content = <MailWorkspace mailbox={mailbox} onMailboxChanged={onChanged} />
    }
  }

  return <WindowFrame titlebar={titlebar}>{content}</WindowFrame>
}
