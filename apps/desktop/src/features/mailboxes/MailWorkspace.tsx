import { Input } from '@/components/ui/input.js'
import type {
  CommandReceipt,
  DesktopEvent,
  Draft,
  MailCommand,
  MailboxSummary,
} from '@mailrovers/mail-contracts'
import type { ConversationId, LabelId, MessageId } from '@mailrovers/mail-domain'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { AiSettings } from '../ai/AiSettings.js'
import { Composer } from '../composer/Composer.js'
import { ConversationReader } from '../conversation/ConversationReader.js'
import { InboxPage } from '../inbox/InboxPage.js'
import { SearchResults } from '../inbox/SearchResults.js'
import { useSearchPages } from '../inbox/useSearchPages.js'

export function MailWorkspace({
  mailbox,
  onMailboxChanged,
}: {
  mailbox: MailboxSummary
  onMailboxChanged: () => Promise<void>
}) {
  const mailboxId = mailbox.id
  const [labelId, setLabelId] = useState<LabelId>()
  const [selectedConversation, setSelectedConversation] = useState<ConversationId>()
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showDrafts, setShowDrafts] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [archiveUndo, setArchiveUndo] = useState<CommandReceipt>()
  const [composer, setComposer] = useState<{
    draft?: Draft | undefined
    conversationId?: ConversationId | undefined
    replyToMessageId?: MessageId | undefined
    sourceVersion?: number | undefined
    to?: string | undefined
    subject?: string | undefined
  }>()
  const drafts = useQuery({
    queryKey: ['drafts', mailboxId],
    queryFn: () => desktopBridge.listDrafts(mailboxId),
    refetchInterval: 5_000,
  })
  const issues = useQuery({
    queryKey: ['command-issues', mailboxId],
    queryFn: () => desktopBridge.listCommandIssues(mailboxId),
    refetchInterval: 5_000,
  })
  const labels = useQuery({
    queryKey: ['labels', mailboxId],
    queryFn: () => desktopBridge.listLabels(mailboxId),
    staleTime: 60_000,
  })
  const inbox = useMemo(
    () => labels.data?.find((label) => label.providerLabelId === 'INBOX'),
    [labels.data],
  )
  useEffect(() => {
    if (labelId === undefined && inbox !== undefined) setLabelId(inbox.id)
  }, [inbox, labelId])
  const executeCommand = async (command: MailCommand) => {
    const receipt = await desktopBridge.executeCommand({
      mailboxId,
      idempotencyKey: crypto.randomUUID(),
      command,
    })
    if (command.kind === 'set-thread-archived' && command.archived) {
      setArchiveUndo(receipt)
      setSelectedConversation(undefined)
    }
  }
  const refresh = async () => {
    const requestId = desktopBridge.createRequestId()
    setRefreshing(true)
    setRefreshStatus('Refreshing…')
    let unsubscribe = desktopBridge.subscribe(requestId, (event: DesktopEvent) => {
      if (event.kind === 'sync-completed') {
        setRefreshStatus('Refresh complete.')
        setRefreshing(false)
      } else if (event.kind === 'sync-failed') {
        setRefreshStatus(event.error.message)
        setRefreshing(false)
      } else if (event.kind === 'sync-cancelled') {
        setRefreshStatus('Refresh cancelled.')
        setRefreshing(false)
      }
    })
    try {
      const receipt = await desktopBridge.startSync({ requestId, mailboxId, reason: 'manual' })
      if (receipt.state === 'deferred') {
        unsubscribe()
        setRefreshStatus(`Refresh deferred until ${new Date(receipt.retryAt).toLocaleString()}.`)
        setRefreshing(false)
      } else if (receipt.requestId !== requestId) {
        unsubscribe()
        unsubscribe = desktopBridge.subscribe(receipt.requestId, () => {})
        setRefreshStatus('Refresh already active.')
      }
    } catch (error) {
      unsubscribe()
      setRefreshStatus(error instanceof Error ? error.message : 'Refresh failed.')
      setRefreshing(false)
    }
  }
  const disconnect = async () => {
    const choice = window.prompt(
      'Type KEEP to disconnect Gmail while retaining readable local mail, or DELETE to remove all local mailbox data. Cancel to stay connected.',
    )
    if (choice === null) return
    const normalized = choice.trim().toUpperCase()
    if (normalized !== 'KEEP' && normalized !== 'DELETE') {
      setRefreshStatus('Disconnect cancelled: enter KEEP or DELETE.')
      return
    }
    await desktopBridge.disconnectMailbox({
      requestId: desktopBridge.createRequestId(),
      mailboxId,
      removeLocalData: normalized === 'DELETE',
    })
    await onMailboxChanged()
  }
  const issue = issues.data?.[0]
  const search = useSearchPages(mailboxId, searchQuery)

  return (
    <main className="grid h-[calc(100vh-56px)] min-w-220 grid-cols-[208px_minmax(320px,390px)_minmax(360px,1fr)] overflow-hidden max-[980px]:min-w-0 max-[980px]:grid-cols-[minmax(280px,340px)_minmax(360px,1fr)]">
      <aside className="overflow-y-auto px-3 py-4.5 max-[980px]:hidden">
        <div className="flex items-center gap-2.5 px-2 pb-4.5">
          <span className="grid size-6.5 place-items-center" aria-hidden="true">
            M
          </span>
          <strong>MailRovers</strong>
        </div>
        <div className="mt-6.5 flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={refreshing || mailbox.connectionState === 'disconnected'}
            onClick={() => void refresh()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void disconnect()}>
            Disconnect
          </Button>
        </div>
        {mailbox.connectionState === 'disconnected' ? (
          <output className="mt-2 block">
            Offline cache retained. Reconnect Gmail to refresh, send, or edit Gmail.
          </output>
        ) : null}
        {refreshStatus ? <output className="mt-2 block">{refreshStatus}</output> : null}
        <Button className="mt-3 mb-3 w-full" onClick={() => setComposer({})}>
          Compose
        </Button>
        <Button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-2 text-start"
          aria-pressed={showDrafts}
          onClick={() => {
            setShowDrafts(true)
            setShowAiSettings(false)
            setSearchInput('')
            setSearchQuery('')
            setSelectedConversation(undefined)
          }}
        >
          <span>Local drafts</span>
          {drafts.data?.length ? <small>{drafts.data.length}</small> : null}
        </Button>
        <Button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-2 text-start"
          aria-pressed={showAiSettings}
          onClick={() => {
            setShowAiSettings(true)
            setShowDrafts(false)
            setSearchInput('')
            setSearchQuery('')
            setSelectedConversation(undefined)
          }}
        >
          <span>AI provider</span>
        </Button>
        <form
          className="mt-1"
          aria-label="Search mail"
          onSubmit={(event) => {
            event.preventDefault()
            setShowDrafts(false)
            setShowAiSettings(false)
            setSearchQuery(searchInput.trim())
            setSelectedConversation(undefined)
          }}
        >
          <label className="sr-only" htmlFor="mail-search">
            Search mail
          </label>
          <Input
            className="w-full px-2.5 py-2"
            id="mail-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search mail"
          />
        </form>
        <nav aria-label="Labels" className="mt-4.5 flex flex-col gap-0.5">
          {labels.isPending ? <p className="p-2">Loading labels…</p> : null}
          {labels.data?.map((label) => (
            <Button
              type="button"
              key={label.id}
              className="flex w-full items-center justify-between px-2.5 py-2 text-start"
              aria-pressed={label.id === labelId && !searchQuery}
              onClick={() => {
                setLabelId(label.id)
                setShowDrafts(false)
                setShowAiSettings(false)
                setSearchQuery('')
                setSearchInput('')
                setSelectedConversation(undefined)
              }}
            >
              <span>{label.name}</span>
              {label.unreadCount > 0 ? <small>{label.unreadCount}</small> : null}
            </Button>
          ))}
        </nav>
      </aside>

      {showAiSettings ? (
        <AiSettings mailboxId={mailboxId} onClose={() => setShowAiSettings(false)} />
      ) : showDrafts ? (
        <section className="min-w-0 overflow-hidden" aria-label="Local drafts">
          <header className="flex h-19 items-center justify-between px-4.5 py-4">
            <div>
              <h1 className="truncate">Local drafts</h1>
              <p className="mt-1">{drafts.data?.length ?? 0} saved on this Mac</p>
            </div>
          </header>
          <div className="h-[calc(100vh-132px)] overflow-y-auto">
            {drafts.data?.map((draft) => (
              <Button
                type="button"
                className="flex w-full flex-col items-start gap-1.5 px-4 py-3 text-start"
                key={draft.id}
                onClick={() => {
                  void (async () => {
                    const conversation =
                      draft.conversationId === undefined
                        ? undefined
                        : await desktopBridge.getConversation({
                            mailboxId,
                            conversationId: draft.conversationId,
                          })
                    setComposer({
                      draft,
                      ...(conversation === undefined
                        ? {}
                        : { sourceVersion: conversation.version }),
                    })
                  })()
                }}
              >
                <strong>{draft.subject || '(No subject)'}</strong>
                <span className="max-w-full truncate">{draft.textBody || 'Empty draft'}</span>
                <small>{draft.syncState}</small>
              </Button>
            ))}
            {drafts.data?.length === 0 ? <p className="px-4.5 py-6">No local drafts.</p> : null}
          </div>
        </section>
      ) : searchQuery ? (
        <section className="min-w-0 overflow-hidden" aria-label="Search results">
          <SearchResults
            pages={search.data}
            selectedConversation={selectedConversation}
            hasNextPage={search.hasNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            isError={search.isError}
            onClear={() => {
              setSearchInput('')
              setSearchQuery('')
            }}
            onLoadMore={() => {
              if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage()
            }}
            onSelect={setSelectedConversation}
          />
        </section>
      ) : (
        <InboxPage
          mailbox={mailboxId}
          labelId={labelId}
          selectedId={selectedConversation}
          onSelect={setSelectedConversation}
        />
      )}

      {selectedConversation ? (
        <ConversationReader
          mailboxId={mailboxId}
          conversationId={selectedConversation}
          labels={labels.data ?? []}
          onCommand={executeCommand}
          onReply={(input) =>
            setComposer({
              conversationId: input.conversationId,
              replyToMessageId: input.messageId,
              sourceVersion: input.sourceVersion,
              to: input.to,
              subject: input.subject,
            })
          }
        />
      ) : (
        <section className="grid place-items-center p-12 text-center">
          <div>
            <strong>Select a conversation</strong>
            <p className="mt-2 max-w-[40ch]">
              Messages stay on this Mac and open from the local cache.
            </p>
          </div>
        </section>
      )}
      {issue ? (
        <aside
          className="fixed top-17 left-1/2 z-45 flex w-[min(620px,calc(100vw-36px))] -translate-x-1/2 items-center gap-2.5 px-3.5 py-3"
          role="alert"
        >
          <div className="min-w-0 flex-1">
            <strong>
              {issue.command.kind === 'send-draft'
                ? 'Confirm whether this message was sent'
                : 'A Gmail change needs attention'}
            </strong>
            <p className="mt-1">MailRovers paused instead of risking a duplicate action.</p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              await desktopBridge.resolveCommand({
                mailboxId,
                commandId: issue.id,
                resolution: 'recheck',
              })
              await issues.refetch()
            }}
          >
            Check Gmail again
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              await desktopBridge.resolveCommand({
                mailboxId,
                commandId: issue.id,
                resolution: 'cancel',
              })
              await issues.refetch()
            }}
          >
            Dismiss
          </Button>
        </aside>
      ) : null}
      {archiveUndo ? (
        <aside className="fixed top-17 left-1/2 z-45 flex w-[min(620px,calc(100vw-36px))] -translate-x-1/2 items-center gap-2.5 px-3.5 py-3">
          <output className="min-w-0 flex-1">Conversation archived.</output>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              const source = archiveUndo
              setArchiveUndo(undefined)
              await desktopBridge.undoCommand({
                mailboxId,
                sourceCommandId: source.id,
                idempotencyKey: crypto.randomUUID(),
              })
            }}
          >
            Undo archive
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setArchiveUndo(undefined)}
          >
            Dismiss
          </Button>
        </aside>
      ) : null}
      {composer ? (
        <Composer mailboxId={mailboxId} seed={composer} onClose={() => setComposer(undefined)} />
      ) : null}
    </main>
  )
}
