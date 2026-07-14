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
    <main className="mail-workspace">
      <aside className="label-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <strong>MailRovers</strong>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary"
            disabled={refreshing || mailbox.connectionState === 'disconnected'}
            onClick={() => void refresh()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="text-button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </div>
        {mailbox.connectionState === 'disconnected' ? (
          <output>Offline cache retained. Reconnect Gmail to refresh, send, or edit Gmail.</output>
        ) : null}
        {refreshStatus ? <output>{refreshStatus}</output> : null}
        <button type="button" className="compose-button" onClick={() => setComposer({})}>
          Compose
        </button>
        <button
          type="button"
          className={showDrafts ? 'label-button active' : 'label-button'}
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
        </button>
        <button
          type="button"
          className={showAiSettings ? 'label-button active' : 'label-button'}
          onClick={() => {
            setShowAiSettings(true)
            setShowDrafts(false)
            setSearchInput('')
            setSearchQuery('')
            setSelectedConversation(undefined)
          }}
        >
          <span>AI provider</span>
        </button>
        <form
          className="mail-search"
          aria-label="Search mail"
          onSubmit={(event) => {
            event.preventDefault()
            setShowDrafts(false)
            setShowAiSettings(false)
            setSearchQuery(searchInput.trim())
            setSelectedConversation(undefined)
          }}
        >
          <label htmlFor="mail-search">Search mail</label>
          <input
            id="mail-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search mail"
          />
        </form>
        <nav aria-label="Labels" className="label-list">
          {labels.isPending ? <p>Loading labels…</p> : null}
          {labels.data?.map((label) => (
            <button
              type="button"
              key={label.id}
              className={
                label.id === labelId && !searchQuery ? 'label-button active' : 'label-button'
              }
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
            </button>
          ))}
        </nav>
      </aside>

      {showAiSettings ? (
        <AiSettings mailboxId={mailboxId} onClose={() => setShowAiSettings(false)} />
      ) : showDrafts ? (
        <section className="conversation-list-panel" aria-label="Local drafts">
          <header className="list-header">
            <div>
              <h1>Local drafts</h1>
              <p>{drafts.data?.length ?? 0} saved on this Mac</p>
            </div>
          </header>
          <div className="search-results">
            {drafts.data?.map((draft) => (
              <button
                type="button"
                className="search-result"
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
                <span>{draft.textBody || 'Empty draft'}</span>
                <small>{draft.syncState}</small>
              </button>
            ))}
            {drafts.data?.length === 0 ? <p className="list-state">No local drafts.</p> : null}
          </div>
        </section>
      ) : searchQuery ? (
        <section className="conversation-list-panel" aria-label="Search results">
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
        <section className="reader-empty">
          <div>
            <strong>Select a conversation</strong>
            <p>Messages stay on this Mac and open from the local cache.</p>
          </div>
        </section>
      )}
      {issue ? (
        <aside className="command-issue" role="alert">
          <div>
            <strong>
              {issue.command.kind === 'send-draft'
                ? 'Confirm whether this message was sent'
                : 'A Gmail change needs attention'}
            </strong>
            <p>MailRovers paused instead of risking a duplicate action.</p>
          </div>
          <button
            type="button"
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
          </button>
          <button
            type="button"
            className="secondary"
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
          </button>
        </aside>
      ) : null}
      {archiveUndo ? (
        <aside className="command-issue">
          <output>Conversation archived.</output>
          <button
            type="button"
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
          </button>
          <button type="button" className="secondary" onClick={() => setArchiveUndo(undefined)}>
            Dismiss
          </button>
        </aside>
      ) : null}
      {composer ? (
        <Composer mailboxId={mailboxId} seed={composer} onClose={() => setComposer(undefined)} />
      ) : null}
    </main>
  )
}
