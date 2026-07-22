import type { Draft, SearchPage } from '@mailrovers/mail-contracts'
import type { ConversationId, LabelId, MailboxId } from '@mailrovers/mail-domain'
import type { InfiniteData } from '@tanstack/react-query'
import type { ComposerMode } from '../composer/Composer.js'
import { InboxPage } from '../inbox/InboxPage.js'
import { SearchResults } from '../inbox/SearchResults.js'
import { AiSettingsColumn } from './AiSettingsColumn.js'
import { DraftsListColumn } from './DraftsListColumn.js'
import type { WorkspaceRoute } from './MailWorkspace.js'

export function WorkspaceRouteColumn({
  route,
  mailboxId,
  activeLabelId,
  activeLabelName,
  activeLabelUnreadCount,
  selectedConversation,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  showSidebarToggle,
  onShowSidebar,
  importInProgress,
  onSelectConversation,
  searchPages,
  searchHasNextPage,
  searchIsFetchingNextPage,
  searchIsError,
  onClearSearch,
  onLoadMoreSearch,
  drafts,
  onOpenComposer,
  onCloseAiSettings,
}: {
  route: WorkspaceRoute
  mailboxId: MailboxId
  activeLabelId: LabelId | undefined
  activeLabelName: string
  activeLabelUnreadCount: number
  selectedConversation: ConversationId | undefined
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearchSubmit: (value: string) => void
  showSidebarToggle: boolean
  onShowSidebar: () => void
  importInProgress: boolean
  onSelectConversation: (conversationId: ConversationId) => void
  searchPages: InfiniteData<SearchPage> | undefined
  searchHasNextPage: boolean
  searchIsFetchingNextPage: boolean
  searchIsError: boolean
  onClearSearch: () => void
  onLoadMoreSearch: () => void
  drafts: Draft[] | undefined
  onOpenComposer: (mode: ComposerMode) => void
  onCloseAiSettings: () => void
}) {
  switch (route.kind) {
    case 'ai-settings':
      return (
        <AiSettingsColumn
          mailboxId={mailboxId}
          showSidebarToggle={showSidebarToggle}
          onShowSidebar={onShowSidebar}
          importInProgress={importInProgress}
          onClose={onCloseAiSettings}
        />
      )
    case 'drafts':
      return (
        <DraftsListColumn
          mailboxId={mailboxId}
          drafts={drafts}
          searchInput={searchInput}
          onSearchInputChange={onSearchInputChange}
          onSearchSubmit={onSearchSubmit}
          showSidebarToggle={showSidebarToggle}
          onShowSidebar={onShowSidebar}
          importInProgress={importInProgress}
          onOpenComposer={onOpenComposer}
        />
      )
    case 'search':
      return (
        <section
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-background"
          aria-label="Search results"
        >
          <SearchResults
            pages={searchPages}
            selectedConversation={selectedConversation}
            hasNextPage={searchHasNextPage}
            isFetchingNextPage={searchIsFetchingNextPage}
            isError={searchIsError}
            searchInput={searchInput}
            onSearchInputChange={onSearchInputChange}
            onSearchSubmit={onSearchSubmit}
            showSidebarToggle={showSidebarToggle}
            onShowSidebar={onShowSidebar}
            importInProgress={importInProgress}
            onClear={onClearSearch}
            onLoadMore={onLoadMoreSearch}
            onSelect={onSelectConversation}
          />
        </section>
      )
    case 'inbox':
      return (
        <InboxPage
          mailbox={mailboxId}
          labelId={activeLabelId}
          title={activeLabelName}
          unreadCount={activeLabelUnreadCount}
          selectedId={selectedConversation}
          searchInput={searchInput}
          onSearchInputChange={onSearchInputChange}
          onSearchSubmit={onSearchSubmit}
          showSidebarToggle={showSidebarToggle}
          onShowSidebar={onShowSidebar}
          importInProgress={importInProgress}
          onSelect={onSelectConversation}
        />
      )
    default: {
      const _exhaustive: never = route
      return _exhaustive
    }
  }
}
