import type { Draft, MailCommand } from '@mailrovers/mail-contracts'
import type { ConversationId, LabelId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { desktopBridge } from '../../desktop-bridge.js'
import { AiSettings } from '../ai/AiSettings.js'
import { Composer } from '../composer/Composer.js'
import { ConversationReader } from '../conversation/ConversationReader.js'
import { InboxPage } from '../inbox/InboxPage.js'

export function MailWorkspace({ mailboxId }: { mailboxId: MailboxId }) {
  const queryClient = useQueryClient()
  const [labelId, setLabelId] = useState<LabelId>()
  const [selectedConversation, setSelectedConversation] = useState<ConversationId>()
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showDrafts, setShowDrafts] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
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
    await desktopBridge.executeCommand({
      mailboxId,
      idempotencyKey: crypto.randomUUID(),
      command,
    })
    if (command.kind === 'set-thread-archived' && command.archived)
      setSelectedConversation(undefined)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['conversations', mailboxId] }),
      queryClient.invalidateQueries({ queryKey: ['conversation', mailboxId] }),
      queryClient.invalidateQueries({ queryKey: ['labels', mailboxId] }),
    ])
  }
  const issue = issues.data?.[0]
  const search = useQuery({
    queryKey: ['search', mailboxId, searchQuery],
    queryFn: () => desktopBridge.searchMail({ mailboxId, query: searchQuery, limit: 50 }),
    enabled: searchQuery.length > 0,
    staleTime: 30_000,
  })

  return (
    <main className="mail-workspace">
      <aside className="label-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <strong>MailRovers</strong>
        </div>
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
          <header className="list-header">
            <div>
              <h1>Search</h1>
              <p>{search.data?.items.length ?? 0} local results</p>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setSearchInput('')
                setSearchQuery('')
              }}
            >
              Clear
            </button>
          </header>
          {search.data?.indexing ? <p className="indexing-note">Indexing older mail…</p> : null}
          <div className="search-results">
            {search.isPending ? <p className="list-state">Searching…</p> : null}
            {search.data?.items.map((hit) => (
              <button
                type="button"
                className={
                  selectedConversation === hit.conversationId
                    ? 'search-result selected'
                    : 'search-result'
                }
                key={hit.messageId}
                onClick={() => setSelectedConversation(hit.conversationId)}
              >
                <strong>{hit.subject || '(No subject)'}</strong>
                <span>{hit.excerpt}</span>
                <small>{hit.sender.name || hit.sender.address}</small>
              </button>
            ))}
          </div>
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
      {composer ? (
        <Composer mailboxId={mailboxId} seed={composer} onClose={() => setComposer(undefined)} />
      ) : null}
    </main>
  )
}
