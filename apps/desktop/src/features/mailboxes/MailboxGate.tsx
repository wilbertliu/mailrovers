import type { MailboxSummary } from '@mailrovers/mail-contracts'
import type { MailboxId, OperationId } from '@mailrovers/mail-domain'
import { Alert02Icon, BrowserIcon, ComputerProtectionIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { StartupSplash } from '@/components/startup-splash.js'
import { Button } from '@/components/ui/button.js'
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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item.js'
import { Spinner } from '@/components/ui/spinner.js'
import logo from '@/assets/logo.png'
import { DesktopApplicationError, desktopBridge } from '../../desktop-bridge.js'
import { MailWorkspace } from './MailWorkspace.js'
import { useMailboxOpeningSplash } from './use-startup-splash.js'

type MailboxGateIntent =
  | { kind: 'mailbox'; mailboxId?: MailboxId | undefined }
  | { kind: 'connect'; mailboxId?: MailboxId | undefined }

type MailboxGateScreen =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | {
      kind: 'connect'
      onConnected: (mailboxId: MailboxId) => Promise<void>
      onCancel?: (() => void) | undefined
    }
  | {
      kind: 'workspace'
      mailbox: MailboxSummary
      mailboxes: MailboxSummary[]
      onSelectMailbox: (mailboxId: MailboxId) => void
      onAddAccount: () => void
    }

function WindowFrame({
  children,
  dragRegion = true,
}: {
  children: ReactNode
  dragRegion?: boolean
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {dragRegion ? <header className="window-titlebar h-11 shrink-0" aria-hidden="true" /> : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function MailboxErrorPage({ onRetry }: { onRetry: () => void }) {
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
          <Button type="button" onClick={onRetry}>
            Retry
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
      if (!cancelled) {
        const secretStorageUnavailable =
          caught instanceof DesktopApplicationError &&
          caught.detail.code === 'SECRET_STORAGE_UNAVAILABLE'
        toast.error('Gmail connection failed', {
          id: 'gmail-connect-error',
          ...(secretStorageUnavailable ? { description: caught.message } : {}),
        })
      }
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
    } catch {
      toast.error("Couldn't cancel connection", {
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
      <div className="flex w-full max-w-xl flex-col items-center gap-6">
        <img src={logo} alt="MailRovers" width={64} height={64} className="size-16" />
        <Card className="w-full">
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
      </div>
    </main>
  )
}

export function MailboxGate() {
  const queryClient = useQueryClient()
  const [intent, setIntent] = useState<MailboxGateIntent>({ kind: 'mailbox' })
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
      setIntent({ kind: 'mailbox', mailboxId })
      await onChanged()
      toast.success('Gmail connected', {
        id: 'gmail-connected',
        description:
          "We're importing your email now. You can use your inbox while that finishes.",
      })
    },
    [onChanged],
  )
  const retryInitialLoad = () => void mailboxes.refetch()
  const openingMailboxes =
    mailboxes.data === undefined && !(mailboxes.isError && !mailboxes.isFetching)
  const showReactStartupSplash = useMailboxOpeningSplash(openingMailboxes)

  let screen: MailboxGateScreen

  if (mailboxes.data === undefined && mailboxes.isError && !mailboxes.isFetching) {
    screen = {
      kind: 'error',
      onRetry: retryInitialLoad,
    }
  } else if (mailboxes.data === undefined) {
    screen = { kind: 'loading' }
  } else {
    const selectedMailboxId = intent.mailboxId
    const mailbox =
      mailboxes.data.find((item) => item.id === selectedMailboxId) ?? mailboxes.data[0]
    if (!mailbox || intent.kind === 'connect') {
      screen = {
        kind: 'connect',
        onConnected,
        ...(intent.kind === 'connect' && mailbox
          ? {
              onCancel: () =>
                setIntent({
                  kind: 'mailbox',
                  ...(intent.mailboxId ? { mailboxId: intent.mailboxId } : {}),
                }),
            }
          : {}),
      }
    } else {
      screen = {
        kind: 'workspace',
        mailbox,
        mailboxes: mailboxes.data,
        onSelectMailbox: (mailboxId) => setIntent({ kind: 'mailbox', mailboxId }),
        onAddAccount: () =>
          setIntent({
            kind: 'connect',
            ...(selectedMailboxId ? { mailboxId: selectedMailboxId } : {}),
          }),
      }
    }
  }

  // Electron keeps a BrowserView splash above this tree until ui-ready.
  // In Storybook / retries, paint the same full-viewport splash without the titlebar frame.
  if (screen.kind === 'loading') {
    return showReactStartupSplash ? <StartupSplash /> : null
  }

  let content: ReactNode
  let dragRegion = true
  switch (screen.kind) {
    case 'error':
      content = <MailboxErrorPage onRetry={screen.onRetry} />
      break
    case 'connect':
      content = (
        <ConnectPage
          onConnected={screen.onConnected}
          {...(screen.onCancel === undefined ? {} : { onCancel: screen.onCancel })}
        />
      )
      break
    case 'workspace':
      dragRegion = false
      content = (
        <MailWorkspace
          key={screen.mailbox.id}
          mailbox={screen.mailbox}
          mailboxes={screen.mailboxes}
          onSelectMailbox={screen.onSelectMailbox}
          onAddAccount={screen.onAddAccount}
        />
      )
      break
    default: {
      const _exhaustive: never = screen
      content = _exhaustive
    }
  }

  return <WindowFrame dragRegion={dragRegion}>{content}</WindowFrame>
}
