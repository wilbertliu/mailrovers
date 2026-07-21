import {
  Add01Icon,
  AiMailIcon,
  ArrowDown01Icon,
  InboxIcon,
  Mail02Icon,
  PencilEdit02Icon,
  SidebarLeftIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CommandReceipt, Draft, MailCommand, MailboxSummary } from '@mailrovers/mail-contracts'
import type { ConversationId, LabelId, MailboxId, MessageId } from '@mailrovers/mail-domain'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.js'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker.js'
import { Spinner } from '@/components/ui/spinner.js'
import { IconTooltipButton } from '@/components/icon-tooltip-button.js'
import { cn } from '@/lib/utils.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { AiSettings } from '../ai/AiSettings.js'
import { Composer } from '../composer/Composer.js'
import { ConversationReader } from '../conversation/ConversationReader.js'
import { InboxPage } from '../inbox/InboxPage.js'
import { ListColumnHeader } from '../inbox/ListColumnHeader.js'
import { SearchResults } from '../inbox/SearchResults.js'
import { useSearchPages } from '../inbox/useSearchPages.js'

function MailboxMenu({
  mailbox,
  mailboxes,
  open,
  onOpenChange,
  onSelectMailbox,
  onAddAccount,
}: {
  mailbox: MailboxSummary
  mailboxes: MailboxSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectMailbox: (mailboxId: MailboxId) => void
  onAddAccount: () => void
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-auto min-w-0 justify-start gap-2 rounded-md px-2 py-1.5 text-sm"
          />
        }
      >
        <span
          className="grid size-5.5 shrink-0 place-items-center rounded-md bg-foreground text-[0.625rem] font-bold text-background"
          aria-hidden="true"
        >
          MR
        </span>
        <strong className="min-w-0 truncate text-left text-sm">MailRovers</strong>
        <HugeiconsIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          icon={ArrowDown01Icon}
          strokeWidth={2}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56" sideOffset={6}>
        <DropdownMenuRadioGroup
          value={mailbox.id}
          onValueChange={(value) => onSelectMailbox(value as MailboxId)}
        >
          <DropdownMenuLabel>Mailboxes</DropdownMenuLabel>
          {mailboxes.map((item) => (
            <DropdownMenuRadioItem key={item.id} value={item.id} className="text-sm">
              <span className="min-w-0 truncate">{item.emailAddress}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-sm" onClick={onAddAccount}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden="true" />
          Add Gmail account
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const sidebarNavClassName =
  'h-8 justify-start gap-2 rounded-md px-2 text-sm text-muted-foreground aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-foreground'

function SidebarCount({ value }: { value: number }) {
  if (value <= 0) return null
  return <small className="ml-auto text-sm font-normal text-muted-foreground">{value}</small>
}

export function MailWorkspace({
  mailbox,
  mailboxes,
  onSelectMailbox,
  onAddAccount,
}: {
  mailbox: MailboxSummary
  mailboxes: MailboxSummary[]
  onSelectMailbox: (mailboxId: MailboxId) => void
  onAddAccount: () => void
}) {
  const mailboxId = mailbox.id
  const [labelId, setLabelId] = useState<LabelId>()
  const [selectedConversation, setSelectedConversation] = useState<ConversationId>()
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showDrafts, setShowDrafts] = useState(false)
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [mailboxMenuOpen, setMailboxMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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
  const activeLabelId = labelId ?? inbox?.id
  const activeLabel = useMemo(() => {
    if (labelId !== undefined) return labels.data?.find((label) => label.id === labelId)
    return inbox
  }, [inbox, labelId, labels.data])
  const activeLabelName = labelId === undefined ? 'Inbox' : (activeLabel?.name ?? 'Inbox')
  const activeLabelUnreadCount = activeLabel?.unreadCount ?? 0
  const clearConversationChrome = () => {
    setSearchInput('')
    setSearchQuery('')
    setSelectedConversation(undefined)
  }
  const showInbox = (nextLabelId?: LabelId) => {
    setShowDrafts(false)
    setShowAiSettings(false)
    setLabelId(nextLabelId)
    clearConversationChrome()
  }
  const showDraftsView = () => {
    setShowDrafts(true)
    setShowAiSettings(false)
    clearConversationChrome()
  }
  const showAiSettingsView = () => {
    setShowAiSettings(true)
    setShowDrafts(false)
    clearConversationChrome()
  }
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
  const submitSearch = () => {
    setShowDrafts(false)
    setShowAiSettings(false)
    setSearchQuery(searchInput.trim())
    setSelectedConversation(undefined)
  }
  const issue = issues.data?.[0]
  const search = useSearchPages(mailboxId, searchQuery)
  const showSidebarToggle = sidebarCollapsed

  return (
    <main
      className={cn(
        'grid h-full min-w-220 overflow-hidden bg-background text-sm text-foreground',
        sidebarCollapsed
          ? 'grid-cols-[minmax(320px,370px)_minmax(390px,1fr)] max-[980px]:min-w-0 max-[980px]:grid-cols-[minmax(280px,340px)_minmax(360px,1fr)]'
          : 'grid-cols-[236px_minmax(320px,370px)_minmax(390px,1fr)] max-[980px]:min-w-0 max-[980px]:grid-cols-[minmax(280px,340px)_minmax(360px,1fr)]',
      )}
      data-disable-window-drag={mailboxMenuOpen || undefined}
    >
      {sidebarCollapsed ? null : (
        <aside className="flex min-h-0 flex-col overflow-y-auto border-r bg-sidebar max-[980px]:hidden">
          <div className="window-titlebar flex h-10 shrink-0 items-center gap-3 pl-21 pt-0.5 pr-2">
            <IconTooltipButton
              label="Hide sidebar"
              icon={SidebarLeftIcon}
              onClick={() => setSidebarCollapsed(true)}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-5 px-2 pt-3 pb-2.5">
            <div className="flex h-9 items-center gap-2 px-0.5">
              <MailboxMenu
                mailbox={mailbox}
                mailboxes={mailboxes}
                open={mailboxMenuOpen}
                onOpenChange={setMailboxMenuOpen}
                onSelectMailbox={onSelectMailbox}
                onAddAccount={onAddAccount}
              />
              <IconTooltipButton
                label="Write email"
                icon={PencilEdit02Icon}
                variant="outline"
                className="ml-auto shrink-0 rounded-full border-border bg-background shadow-sm hover:bg-muted hover:text-foreground"
                onClick={() => setComposer({})}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <nav className="flex flex-col gap-1" aria-label="Workspace">
                {labels.isError ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    className={sidebarNavClassName}
                    aria-pressed={!showDrafts && !showAiSettings && !searchQuery}
                    onClick={() => showInbox()}
                  >
                    <HugeiconsIcon icon={InboxIcon} data-icon="inline-start" aria-hidden="true" />
                    <span>Inbox</span>
                    <SidebarCount value={inbox?.unreadCount ?? 0} />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className={sidebarNavClassName}
                  aria-label="Local drafts"
                  aria-pressed={showDrafts}
                  onClick={showDraftsView}
                >
                  <HugeiconsIcon icon={Mail02Icon} data-icon="inline-start" aria-hidden="true" />
                  <span>Drafts</span>
                  <SidebarCount value={drafts.data?.length ?? 0} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className={sidebarNavClassName}
                  aria-pressed={showAiSettings}
                  onClick={showAiSettingsView}
                >
                  <HugeiconsIcon icon={AiMailIcon} data-icon="inline-start" aria-hidden="true" />
                  <span>AI provider</span>
                </Button>
              </nav>
              <nav className="flex flex-col gap-1" aria-label="Labels">
                {labels.isPending ? (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading labels…</p>
                ) : null}
                {labels.data
                  ?.filter((label) => label.providerLabelId !== 'INBOX')
                  .map((label) => (
                    <Button
                      type="button"
                      variant="ghost"
                      className={sidebarNavClassName}
                      key={label.id}
                      aria-pressed={
                        label.id === activeLabelId &&
                        !searchQuery &&
                        !showDrafts &&
                        !showAiSettings
                      }
                      onClick={() => showInbox(label.id)}
                    >
                      <i className="size-1.5 rounded-xs bg-chart-2" aria-hidden="true" />
                      <span>{label.name}</span>
                      <SidebarCount value={label.unreadCount} />
                    </Button>
                  ))}
              </nav>
            </div>
            <div className="mt-auto space-y-1 pt-1">
              {mailbox.connectionState === 'disconnected' ? (
                <output className="block px-0.5 text-sm leading-snug text-muted-foreground">
                  Offline cache retained. Reconnect Gmail to refresh, send, or edit Gmail.
                </output>
              ) : null}
              {mailbox.connectionState === 'connected' && mailbox.syncState !== 'ready' ? (
                <Marker
                  className="w-auto text-sm text-muted-foreground"
                  render={<output aria-live="polite" />}
                >
                  <MarkerIcon>
                    <Spinner aria-hidden="true" />
                  </MarkerIcon>
                  <MarkerContent>Importing older mail</MarkerContent>
                </Marker>
              ) : null}
            </div>
          </div>
        </aside>
      )}

      {showAiSettings ? (
        <section
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
          aria-label="AI provider"
        >
          {showSidebarToggle ? (
            <div className="window-titlebar flex h-10 shrink-0 items-center gap-3 border-b pl-21 pt-0.5 pr-2">
              <IconTooltipButton
                label="Show sidebar"
                icon={SidebarLeftIcon}
                onClick={() => setSidebarCollapsed(false)}
              />
            </div>
          ) : null}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <AiSettings mailboxId={mailboxId} onClose={() => setShowAiSettings(false)} />
          </div>
        </section>
      ) : showDrafts ? (
        <section
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
          aria-label="Local drafts"
        >
          <ListColumnHeader
            title="Local drafts"
            subtitle={`${drafts.data?.length ?? 0} saved on this Mac`}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            onSearchSubmit={submitSearch}
            showSidebarToggle={showSidebarToggle}
            onShowSidebar={() => setSidebarCollapsed(false)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {drafts.data?.map((draft) => (
              <Button
                type="button"
                variant="ghost"
                className="flex w-full flex-col items-start gap-1.5 rounded-md px-4 py-3 text-start text-sm aria-pressed:bg-accent"
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
                <strong className="text-sm font-medium">{draft.subject || '(No subject)'}</strong>
                <span className="max-w-full truncate text-sm text-muted-foreground">
                  {draft.textBody || 'Empty draft'}
                </span>
                <small className="text-sm text-muted-foreground">{draft.syncState}</small>
              </Button>
            ))}
            {drafts.data?.length === 0 ? (
              <p className="px-4 py-6 text-sm">No local drafts.</p>
            ) : null}
          </div>
        </section>
      ) : searchQuery ? (
        <section
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
          aria-label="Search results"
        >
          <SearchResults
            pages={search.data}
            selectedConversation={selectedConversation}
            hasNextPage={search.hasNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            isError={search.isError}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            onSearchSubmit={submitSearch}
            showSidebarToggle={showSidebarToggle}
            onShowSidebar={() => setSidebarCollapsed(false)}
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
          labelId={activeLabelId}
          title={activeLabelName}
          unreadCount={activeLabelUnreadCount}
          selectedId={selectedConversation}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          onSearchSubmit={submitSearch}
          showSidebarToggle={showSidebarToggle}
          onShowSidebar={() => setSidebarCollapsed(false)}
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
        <section className="window-titlebar grid place-items-center bg-card p-12 text-center">
          <div>
            <strong className="text-sm">Select a conversation</strong>
            <p className="mt-2 max-w-[40ch] text-sm text-muted-foreground">
              Messages stay on this Mac and open from the local cache.
            </p>
          </div>
        </section>
      )}
      {issue ? (
        <aside
          className="fixed top-17 left-1/2 z-45 flex w-[min(620px,calc(100vw-36px))] -translate-x-1/2 items-center gap-2.5 rounded-lg border bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-sm"
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
        <aside className="fixed top-17 left-1/2 z-45 flex w-[min(620px,calc(100vw-36px))] -translate-x-1/2 items-center gap-2.5 rounded-lg border bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-sm">
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
