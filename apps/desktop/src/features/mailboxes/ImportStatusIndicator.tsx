import type { MailboxSummary, SyncStatus } from '@mailrovers/mail-contracts'
import type { OperationId } from '@mailrovers/mail-domain'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { FieldError } from '@/components/ui/field.js'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover.js'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress.js'
import { Spinner } from '@/components/ui/spinner.js'
import { desktopBridge } from '../../desktop-bridge.js'

type ImportPhase = SyncStatus['phase'] | MailboxSummary['syncState']

function progressLabel(phase: ImportPhase): string {
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
    default: {
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
}

function indicatorLabel(phase: ImportPhase): string {
  switch (phase) {
    case 'paused':
      return 'Import paused'
    case 'failed':
      return 'Import needs attention'
    case 'auth_required':
      return 'Gmail needs reconnect'
    case 'complete':
    case 'ready':
      return 'Import complete'
    case 'importing_labels':
    case 'importing_messages':
    case 'importing_drafts':
    case 'importing':
    case 'reconciling_history':
    case 'full_reconciliation':
    case 'reconciling':
    case 'authenticating':
    case 'idle':
      return 'Importing email'
    default: {
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
}

export function ImportStatusIndicator({ mailbox }: { mailbox: MailboxSummary }) {
  const queryClient = useQueryClient()
  const [operation, setOperation] = useState<OperationId>()
  const [error, setError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<'pause' | 'resume' | 'disconnect'>()
  const statusQuery = useQuery({
    queryKey: ['sync-status', mailbox.id],
    queryFn: () =>
      desktopBridge.getSyncStatus({
        requestId: desktopBridge.createRequestId(),
        mailboxId: mailbox.id,
      }),
  })
  const status = statusQuery.data
  const phase = status?.phase ?? mailbox.syncState
  const label = indicatorLabel(phase)
  const needsAttention =
    phase === 'paused' || phase === 'failed' || phase === 'auth_required'
  const failed = phase === 'failed' || phase === 'auth_required'
  const imported = status?.importedMessageCount ?? mailbox.importedMessageCount
  const total = status?.totalEstimate ?? mailbox.importTotalEstimate
  const progress = total && total > 0 ? Math.min(100, (imported / total) * 100) : undefined

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['sync-status', mailbox.id] })
    await queryClient.invalidateQueries({ queryKey: ['mailboxes'] })
  }, [mailbox.id, queryClient])

  const start = useCallback(async () => {
    const requestId = desktopBridge.createRequestId()
    const receipt = await desktopBridge.startSync({ requestId, mailboxId: mailbox.id })
    setOperation(receipt.requestId)
    return receipt.requestId
  }, [mailbox.id])

  const pause = async () => {
    setPendingAction('pause')
    setError(undefined)
    try {
      const activeOperation = operation ?? (await start())
      await desktopBridge.cancelOperation({
        requestId: desktopBridge.createRequestId(),
        operationId: activeOperation,
      })
      await refresh()
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
      await start()
      await refresh()
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
      if (operation) {
        await desktopBridge.cancelOperation({
          requestId: desktopBridge.createRequestId(),
          operationId: operation,
        })
      }
      await desktopBridge.disconnectMailbox({
        requestId: desktopBridge.createRequestId(),
        mailboxId: mailbox.id,
        removeLocalData: true,
      })
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to disconnect Gmail.')
    } finally {
      setPendingAction(undefined)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-ml-1 rounded-md"
            aria-label={label}
          />
        }
      >
        {needsAttention ? (
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Spinner aria-hidden="true" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-3" sideOffset={6}>
        <PopoverHeader className="gap-1">
          <PopoverTitle className="text-sm">{progressLabel(phase)}</PopoverTitle>
          <PopoverDescription className="text-xs">
            {imported.toLocaleString()} messages imported
            {total === undefined ? '' : ` of about ${total.toLocaleString()}`}
          </PopoverDescription>
        </PopoverHeader>
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
        <div className="flex flex-wrap gap-2">
          {needsAttention ? (
            <Button
              type="button"
              size="sm"
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
              size="sm"
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
            size="sm"
            variant="destructive"
            onClick={() => void disconnect()}
            disabled={pendingAction !== undefined}
          >
            {pendingAction === 'disconnect' ? <Spinner data-icon="inline-start" /> : null}
            {pendingAction === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          You can close MailRovers. The import resumes when you reopen it.
        </p>
      </PopoverContent>
    </Popover>
  )
}
