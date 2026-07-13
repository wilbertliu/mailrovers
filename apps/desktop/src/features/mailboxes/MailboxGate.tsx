import type { DesktopEvent, MailboxSummary, SyncStatus } from '@mailrovers/mail-contracts'
import type { MailboxId, OperationId } from '@mailrovers/mail-domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { desktopBridge } from '../../desktop-bridge.js'
import { InboxPage } from '../inbox/InboxPage.js'

function LoadingPage({ message }: { message: string }) {
  return (
    <main className="centered-page">
      <section className="panel" aria-live="polite">
        <h1>MailRovers</h1>
        <p>{message}</p>
      </section>
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
  const [connecting, setConnecting] = useState(false)
  const [operation, setOperation] = useState<OperationId>()
  const [error, setError] = useState<string>()

  const connect = async () => {
    const requestId = desktopBridge.createRequestId()
    setOperation(requestId)
    setConnecting(true)
    setError(undefined)
    try {
      const result = await desktopBridge.connectGmail({ requestId })
      await onConnected(result.mailbox.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gmail connection failed.')
    } finally {
      setConnecting(false)
      setOperation(undefined)
    }
  }

  const cancel = async () => {
    if (!operation) return
    await desktopBridge.cancelOperation({
      requestId: desktopBridge.createRequestId(),
      operationId: operation,
    })
  }

  return (
    <main className="centered-page">
      <section className="panel connect-panel">
        <p className="eyebrow">Local-first email</p>
        <h1>Connect Gmail</h1>
        <p>
          MailRovers stores your mail on this Mac. Google authorization opens in your default
          browser.
        </p>
        {error ? (
          <p role="alert" className="error-message">
            {error}
          </p>
        ) : null}
        <div className="button-row">
          <button type="button" onClick={() => void connect()} disabled={connecting}>
            {connecting ? 'Waiting for Google…' : 'Connect Gmail'}
          </button>
          {connecting ? (
            <button type="button" className="secondary" onClick={() => void cancel()}>
              Cancel
            </button>
          ) : onCancel ? (
            <button type="button" className="secondary" onClick={onCancel}>
              Back
            </button>
          ) : null}
        </div>
      </section>
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

  const refreshStatus = useCallback(async () => {
    const value = await desktopBridge.getSyncStatus({
      requestId: desktopBridge.createRequestId(),
      mailboxId: mailbox.id,
    })
    setStatus(value)
  }, [mailbox.id])

  const handleEvent = useCallback(
    (event: DesktopEvent) => {
      if (event.kind === 'sync-failed') {
        setError(event.error.message)
        void onChanged()
        return
      }
      setStatus(event.status)
      if (event.kind === 'sync-completed' || event.kind === 'sync-cancelled') void onChanged()
    },
    [onChanged],
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
    const timer = setInterval(() => void refreshStatus(), 2_000)
    return () => {
      active = false
      clearInterval(timer)
      unsubscribe?.()
    }
  }, [handleEvent, mailbox.syncState, refreshStatus, start])

  const pause = async () => {
    const activeOperation = operation ?? (await start())
    await desktopBridge.cancelOperation({
      requestId: desktopBridge.createRequestId(),
      operationId: activeOperation,
    })
    await refreshStatus()
    await onChanged()
  }

  const resume = async () => {
    setError(undefined)
    const requestId = await start()
    desktopBridge.subscribe(requestId, handleEvent)
    await onChanged()
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect Gmail and remove its local MailRovers data?')) return
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
  }

  const imported = status?.importedMessageCount ?? mailbox.importedMessageCount
  const total = status?.totalEstimate ?? mailbox.importTotalEstimate
  const progress = total && total > 0 ? Math.min(100, (imported / total) * 100) : undefined
  const paused = status?.phase === 'paused' || mailbox.syncState === 'paused'
  const failed = status?.phase === 'failed' || mailbox.syncState === 'failed'

  return (
    <main className="centered-page">
      <section className="panel progress-panel">
        <p className="eyebrow">{mailbox.emailAddress}</p>
        <h1>{progressLabel(status, mailbox)}</h1>
        <p>
          {imported.toLocaleString()} messages imported
          {total === undefined ? '' : ` of about ${total.toLocaleString()}`}
        </p>
        <progress
          className="progress-track"
          aria-label="Gmail import progress"
          max={100}
          {...(progress === undefined ? {} : { value: progress })}
        />
        {error ? (
          <p role="alert" className="error-message">
            {error}
          </p>
        ) : null}
        <div className="button-row">
          {paused || failed ? (
            <button type="button" onClick={() => void resume()}>
              {failed ? 'Retry import' : 'Resume import'}
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => void pause()}>
              Pause import
            </button>
          )}
          <button type="button" className="text-button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </div>
        <p className="fine-print">
          You can close MailRovers. The import resumes when you reopen it.
        </p>
      </section>
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
    return <LoadingPage message="MailRovers could not open its local mailbox." />
  const mailbox = mailboxes.data.find((item) => item.id === selectedMailbox) ?? mailboxes.data[0]
  if (!mailbox || showConnect)
    return (
      <ConnectPage
        onConnected={onConnected}
        {...(mailbox ? { onCancel: () => setShowConnect(false) } : {})}
      />
    )
  if (mailbox.syncState !== 'ready') return <ImportPage mailbox={mailbox} onChanged={onChanged} />
  return (
    <>
      <nav className="mailbox-nav" aria-label="Mailboxes">
        <label>
          <span>Mailbox</span>
          <select
            value={mailbox.id}
            onChange={(event) => setSelectedMailbox(mailboxes.data[event.target.selectedIndex]?.id)}
          >
            {mailboxes.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.emailAddress}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary" onClick={() => setShowConnect(true)}>
          Add Gmail account
        </button>
      </nav>
      <InboxPage mailbox={mailbox.id} />
    </>
  )
}
