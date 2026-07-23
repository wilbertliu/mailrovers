import {
  Add01Icon,
  AiMailIcon,
  ArrowDown01Icon,
  InboxIcon,
  LabelIcon,
  Mail02Icon,
  PencilEdit02Icon,
  SidebarLeftIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { CommandReceipt, MailCommand, MailboxSummary } from '@mailrovers/mail-contracts'
import type { ConversationId, LabelId, MailboxId } from '@mailrovers/mail-domain'
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
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar.js'
import { IconTooltipButton } from '@/components/icon-tooltip-button.js'
import { cn } from '@/lib/utils.js'
import { desktopBridge } from '../../desktop-bridge.js'
import { Composer, type ComposerMode } from '../composer/Composer.js'
import { ConversationReader } from '../conversation/ConversationReader.js'
import { useSearchPages } from '../inbox/useSearchPages.js'
import { ImportStatusIndicator } from './ImportStatusIndicator.js'
import { WorkspaceRouteColumn } from './WorkspaceRouteColumn.js'

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
        render={<SidebarMenuButton size="sm" className="h-auto min-w-0" />}
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

function SidebarMenuCount({ value }: { value: number }) {
  if (value <= 0) return null
  return (
    <small className="ml-auto shrink-0 tabular-nums font-normal text-muted-foreground">{value}</small>
  )
}

export type WorkspaceRoute =
  | { kind: 'inbox'; labelId?: LabelId | undefined }
  | { kind: 'search'; query: string }
  | { kind: 'drafts' }
  | { kind: 'ai-settings' }

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
  const [route, setRoute] = useState<WorkspaceRoute>({ kind: 'inbox' })
  const [selectedConversation, setSelectedConversation] = useState<ConversationId>()
  const [searchInput, setSearchInput] = useState('')
  const [mailboxMenuOpen, setMailboxMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [archiveUndo, setArchiveUndo] = useState<CommandReceipt>()
  const [composer, setComposer] = useState<ComposerMode>()
  const drafts = useQuery({
    queryKey: ['drafts', mailboxId],
    queryFn: () => desktopBridge.listDrafts(mailboxId),
  })
  const issues = useQuery({
    queryKey: ['command-issues', mailboxId],
    queryFn: () => desktopBridge.listCommandIssues(mailboxId),
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
  const activeLabelId = route.kind === 'inbox' ? (route.labelId ?? inbox?.id) : undefined
  const activeLabel = useMemo(() => {
    if (route.kind !== 'inbox' || route.labelId === undefined) return inbox
    return labels.data?.find((label) => label.id === route.labelId)
  }, [inbox, labels.data, route])
  const activeLabelName =
    route.kind === 'inbox' && route.labelId !== undefined ? (activeLabel?.name ?? 'Inbox') : 'Inbox'
  const activeLabelUnreadCount = activeLabel?.unreadCount ?? 0
  const clearWorkspaceSelection = () => {
    setSearchInput('')
    setSelectedConversation(undefined)
  }
  const showInbox = (nextLabelId?: LabelId) => {
    setRoute(
      nextLabelId === undefined ? { kind: 'inbox' } : { kind: 'inbox', labelId: nextLabelId },
    )
    clearWorkspaceSelection()
  }
  const showDraftsView = () => {
    setRoute({ kind: 'drafts' })
    clearWorkspaceSelection()
  }
  const showAiSettingsView = () => {
    setRoute({ kind: 'ai-settings' })
    clearWorkspaceSelection()
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
  const submitSearch = (value: string) => {
    setSearchInput(value)
    const query = value.trim()
    setRoute(query.length === 0 ? { kind: 'inbox' } : { kind: 'search', query })
    setSelectedConversation(undefined)
  }
  const issue = issues.data?.[0]
  const search = useSearchPages(mailboxId, route.kind === 'search' ? route.query : '')
  const showSidebarToggle = sidebarCollapsed
  const importMailbox =
    mailbox.connectionState === 'connected' && mailbox.syncState !== 'ready' ? mailbox : undefined

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
          <div className="window-titlebar flex h-10 shrink-0 items-center gap-0 pl-21 pt-0.5 pr-2">
            <IconTooltipButton
              label="Hide sidebar"
              icon={SidebarLeftIcon}
              onClick={() => setSidebarCollapsed(true)}
            />
            {importMailbox ? <ImportStatusIndicator mailbox={importMailbox} /> : null}
          </div>
          <SidebarProvider className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SidebarHeader className="flex-row items-center gap-2">
              <SidebarMenu className="min-w-0 flex-1">
                <SidebarMenuItem className="min-w-0">
                  <MailboxMenu
                    mailbox={mailbox}
                    mailboxes={mailboxes}
                    open={mailboxMenuOpen}
                    onOpenChange={setMailboxMenuOpen}
                    onSelectMailbox={onSelectMailbox}
                    onAddAccount={onAddAccount}
                  />
                </SidebarMenuItem>
              </SidebarMenu>
              <IconTooltipButton
                label="Write email"
                icon={PencilEdit02Icon}
                variant="outline"
                className="shrink-0 rounded-full border-border bg-background shadow-sm hover:bg-muted hover:text-foreground"
                onClick={() => setComposer({ kind: 'new' })}
              />
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {labels.isError ? null : (
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            size="sm"
                            isActive={route.kind === 'inbox' && route.labelId === undefined}
                            onClick={() => showInbox()}
                          >
                            <HugeiconsIcon icon={InboxIcon} aria-hidden="true" />
                            <span className="min-w-0 truncate">Inbox</span>
                            <SidebarMenuCount value={inbox?.unreadCount ?? 0} />
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      )}
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          size="sm"
                          isActive={route.kind === 'drafts'}
                          aria-label="Local drafts"
                          onClick={showDraftsView}
                        >
                          <HugeiconsIcon icon={Mail02Icon} aria-hidden="true" />
                          <span className="min-w-0 truncate">Drafts</span>
                          <SidebarMenuCount value={drafts.data?.length ?? 0} />
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          size="sm"
                          isActive={route.kind === 'ai-settings'}
                          onClick={showAiSettingsView}
                        >
                          <HugeiconsIcon icon={AiMailIcon} aria-hidden="true" />
                          <span>AI provider</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
                {labels.isError ? null : (
                  <SidebarGroup>
                    <SidebarGroupLabel>Labels</SidebarGroupLabel>
                    <SidebarGroupContent>
                      {labels.isPending ? (
                        <p className="px-3 py-1.5 text-sm text-muted-foreground">Loading labels…</p>
                      ) : (
                        <SidebarMenu>
                          {labels.data
                            ?.filter((label) => label.providerLabelId !== 'INBOX')
                            .map((label) => (
                              <SidebarMenuItem key={label.id}>
                                <SidebarMenuButton
                                  size="sm"
                                  isActive={route.kind === 'inbox' && label.id === activeLabelId}
                                  onClick={() => showInbox(label.id)}
                                >
                                  <HugeiconsIcon icon={LabelIcon} aria-hidden="true" />
                                  <span className="min-w-0 truncate">{label.name}</span>
                                  <SidebarMenuCount value={label.unreadCount} />
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                      )}
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}
            </SidebarContent>
            {mailbox.connectionState === 'disconnected' ? (
              <SidebarFooter>
                <output className="block text-sm leading-snug text-muted-foreground">
                  Offline cache retained. Reconnect Gmail to refresh, send, or edit Gmail.
                </output>
              </SidebarFooter>
            ) : null}
          </SidebarProvider>
        </aside>
      )}

      <WorkspaceRouteColumn
        route={route}
        mailboxId={mailboxId}
        activeLabelId={activeLabelId}
        activeLabelName={activeLabelName}
        activeLabelUnreadCount={activeLabelUnreadCount}
        selectedConversation={selectedConversation}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={submitSearch}
        showSidebarToggle={showSidebarToggle}
        onShowSidebar={() => setSidebarCollapsed(false)}
        importMailbox={importMailbox}
        onSelectConversation={setSelectedConversation}
        searchPages={search.data}
        searchHasNextPage={search.hasNextPage}
        searchIsFetchingNextPage={search.isFetchingNextPage}
        searchIsError={search.isError}
        onClearSearch={showInbox}
        onLoadMoreSearch={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage()
        }}
        drafts={drafts.data}
        onOpenComposer={setComposer}
        onCloseAiSettings={showInbox}
      />

      {selectedConversation ? (
        <ConversationReader
          mailboxId={mailboxId}
          conversationId={selectedConversation}
          labels={labels.data ?? []}
          onCommand={executeCommand}
          onReply={(input) =>
            setComposer({
              kind: 'reply',
              context: {
                conversationId: input.conversationId,
                replyToMessageId: input.messageId,
                sourceVersion: input.sourceVersion,
              },
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
        <Composer
          key={
            composer.kind === 'new'
              ? 'new'
              : composer.kind === 'reply'
                ? `reply-${composer.context.conversationId}-${composer.context.replyToMessageId}`
                : `edit-${composer.draft.id}`
          }
          mailboxId={mailboxId}
          mode={composer}
          onClose={() => setComposer(undefined)}
        />
      ) : null}
    </main>
  )
}
