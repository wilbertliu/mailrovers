import type { DesktopEvent, MailboxSummary, SyncStatus } from '@mailrovers/mail-contracts'
import type { MailboxId, OperationId } from '@mailrovers/mail-domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { MailAccount01Icon } from '@hugeicons/core-free-icons'
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
import { FieldError } from '@/components/ui/field.js'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress.js'
import { Spinner } from '@/components/ui/spinner.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { MailWorkspace } from './MailWorkspace.js'

function LoadingPage({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-lg" aria-live={error ? undefined : 'polite'}>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HugeiconsIcon icon={MailAccount01Icon} strokeWidth={2} className="size-6" />
          </div>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight">MailRovers</h1>
          </CardTitle>
          {!error ? (
            <CardDescription className="flex items-center gap-2 text-pretty">
              <Spinner aria-hidden="true" />
              {message}
            </CardDescription>
          ) : null}
        </CardHeader>
        {error ? (
          <CardContent>
            <FieldError>{message}</FieldError>
          </CardContent>
        ) : null}
      </Card>
    </main>
  )
}

function ConnectPage({
  onConnected,
  onCancel,
}: {
  onConnected: (mailboxId: MailboxId) => Promise<void>
  onCancel?: (() => void) | undefined
}) {
  const [pendingAction, setPendingAction] = useState<'connect' | 'cancel'>()
  const [operation, setOperation] = useState<OperationId>()
  const [error, setError] = useState<string>()

  const connect = async () => {
    const requestId = desktopBridge.createRequestId()
    setOperation(requestId)
    setPendingAction('connect')
    setError(undefined)
    try {
      const result = await desktopBridge.connectGmail({ requestId })
      await onConnected(result.mailbox.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gmail connection failed.')
    } finally {
      setPendingAction(undefined)
      setOperation(undefined)
    }
  }

  const cancel = async () => {
    if (!operation) return
    setPendingAction('cancel')
    setError(undefined)
    try {
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: operation,
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to cancel Gmail connection.')
      setPendingAction('connect')
    }
  }

  const connecting = pendingAction !== undefined

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="text-xs font-medium tracking-wider text-primary uppercase">
            Local-first email
          </p>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">Connect Gmail</h1>
          </CardTitle>
          <CardDescription className="text-pretty">
            MailRovers stores your mail on this Mac. Google authorization opens in your default
            browser.
          </CardDescription>
        </CardHeader>
        {error ? (
          <CardContent>
            <FieldError>{error}</FieldError>
          </CardContent>
        ) : null}
        <CardFooter className="gap-2">
          <Button type="button" onClick={() => void connect()} disabled={connecting}>
            {pendingAction === 'connect' ? <Spinner data-icon="inline-start" /> : null}
            {pendingAction === 'connect' ? 'Waiting for Google…' : 'Connect Gmail'}
          </Button>
          {connecting ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void cancel()}
              disabled={pendingAction === 'cancel'}
            >
              {pendingAction === 'cancel' ? <Spinner data-icon="inline-start" /> : null}
              {pendingAction === 'cancel' ? 'Cancelling…' : 'Cancel'}
            </Button>
          ) : onCancel ? (
            <Button type="button" variant="secondary" onClick={onCancel}>
              Back
            </Button>
          ) : null}
        </CardFooter>
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
  const [status, setStatus] = useState<SyncStatus>()
  const [operation, setOperation] = useState<OperationId>()
  const [error, setError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'disconnect'>()

  const refreshStatus = useCallback(async () => {
    const value = await desktopBridge.getSyncStatus({
      requestId: desktopBridge.createRequestId(),
      mailboxId: mailbox.id,
    })
    setStatus(value)
  }, [mailbox.id])

  const handleEvent = useCallback(
    (event: DesktopEvent) => {
      switch (event.kind) {
        case 'sync-failed':
          setError(event.error.message)
          void onChanged()
          break
        case 'sync-progress':
          setStatus(event.status)
          break
        case 'sync-completed':
        case 'sync-cancelled':
          setStatus(event.status)
          void onChanged()
          break
        case 'events-overflowed':
          void refreshStatus()
          void onChanged()
          break
      }
    },
    [onChanged, refreshStatus],
  )

  const start = useCallback(async () => {
    const requestId = desktopBridge.createRequestId()
    const receipt = await desktopBridge.startSync({ requestId, mailboxId: mailbox.id })
    setOperation(receipt.requestId)
    return receipt.requestId
  }, [mailbox.id])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let active = true
    void refreshStatus().catch((caught) => {
      if (active)
        setError(caught instanceof Error ? caught.message : 'Unable to load import status.')
    })
    if (mailbox.syncState === 'importing' || mailbox.syncState === 'reconciling')
      void start()
        .then((requestId) => {
          if (active) unsubscribe = desktopBridge.subscribe(requestId, handleEvent)
        })
        .catch((caught) => {
          if (active)
            setError(caught instanceof Error ? caught.message : 'Unable to resume import.')
        })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [handleEvent, mailbox.syncState, refreshStatus, start])

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
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="truncate text-xs font-medium tracking-wider text-primary uppercase">
            {mailbox.emailAddress}
          </p>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              {progressLabel(status, mailbox)}
            </h1>
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
          {error ? <FieldError>{error}</FieldError> : null}
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
          <p className="basis-full pt-3 text-xs text-muted-foreground">
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

  if (mailboxes.isPending) return <LoadingPage message="Opening your local mailbox…" />
  if (mailboxes.isError)
    return <LoadingPage message="MailRovers could not open its local mailbox." error />
  const mailbox = mailboxes.data.find((item) => item.id === selectedMailbox) ?? mailboxes.data[0]
  if (!mailbox || showConnect)
    return (
      <ConnectPage
        onConnected={onConnected}
        {...(mailbox ? { onCancel: () => setShowConnect(false) } : {})}
      />
    )
  if (mailbox.connectionState === 'connected' && mailbox.syncState !== 'ready')
    return <ImportPage mailbox={mailbox} onChanged={onChanged} />
  return (
    <>
      <nav
        className="flex h-14 items-center justify-between border-b border-border bg-panel px-4 py-2"
        aria-label="Mailboxes"
      >
        <label className="flex items-center gap-2.5 text-xs font-semibold text-muted-foreground">
          <span>Mailbox</span>
          <NativeSelect
            className="min-w-55 rounded-lg border border-border bg-surface py-1.5 pr-7 pl-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={mailbox.id}
            onChange={(event) => setSelectedMailbox(mailboxes.data[event.target.selectedIndex]?.id)}
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
      <MailWorkspace mailbox={mailbox} onMailboxChanged={onChanged} />
    </>
  )
}
