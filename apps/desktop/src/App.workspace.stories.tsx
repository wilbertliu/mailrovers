import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { App } from './App.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'
import {
  WorkspaceLinearRedesign,
  type WorkspaceLinearState,
} from './storybook/WorkspaceLinearRedesign.js'

const meta = {
  title: 'Flows/Workspace',
  component: App,
  parameters: { layout: 'fullscreen' },
  globals: { theme: 'light' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

function renderLinear(state: WorkspaceLinearState) {
  return () => <WorkspaceLinearRedesign state={state} />
}

export const PopulatedInbox: Story = {
  parameters: { mailrovers: storybookScenarios.workspace },
  render: renderLinear('populated'),
}

export const EmptyInbox: Story = {
  parameters: { mailrovers: storybookScenarios.emptyInbox },
  render: renderLinear('empty'),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('No conversations in this view.'),
    ).toBeVisible()
  },
}

export const InboxLoading: Story = {
  parameters: { mailrovers: storybookScenarios.inboxLoading },
  render: renderLinear('loading'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Loading mail…')).toBeVisible()
  },
}

export const InboxFailedToLoad: Story = {
  parameters: { mailrovers: storybookScenarios.inboxError },
  render: renderLinear('error'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Unable to load local mail.',
    )
  },
}

export const LabelsLoading: Story = {
  parameters: { mailrovers: storybookScenarios.labelsLoading },
  render: renderLinear('labels-loading'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Loading labels…')).toBeVisible()
  },
}

export const LabelsFailedToLoad: Story = {
  parameters: { mailrovers: storybookScenarios.labelsError },
  render: renderLinear('labels-error'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: /Inbox/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Inbox' })).not.toBeInTheDocument()
  },
}

export const ConversationSelected: Story = {
  parameters: { mailrovers: storybookScenarios.conversation },
  render: renderLinear('conversation'),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', {
        name: 'Launch checklist and final copy',
      }),
    ).toBeVisible()
  },
}

export const SearchResults: Story = {
  parameters: { mailrovers: storybookScenarios.searchResults },
  render: renderLinear('search'),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { name: /Search/ }),
    ).toBeVisible()
  },
}

export const LocalDrafts: Story = {
  parameters: { mailrovers: storybookScenarios.drafts },
  render: renderLinear('drafts'),
}

export const NoLocalDrafts: Story = {
  parameters: { mailrovers: storybookScenarios.emptyDrafts },
  render: renderLinear('drafts-empty'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('No local drafts.')).toBeVisible()
  },
}

export const DraftsLoading: Story = {
  parameters: { mailrovers: storybookScenarios.draftsLoading },
  render: renderLinear('drafts-loading'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('0 saved on this Mac')).toBeVisible()
  },
}

export const CommandNeedsReview: Story = {
  parameters: { mailrovers: storybookScenarios.commandIssue },
  render: renderLinear('command-issue'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Confirm whether this message was sent',
    )
  },
}

export const GmailChangeNeedsReview: Story = {
  parameters: { mailrovers: storybookScenarios.genericCommandIssue },
  render: renderLinear('gmail-issue'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'A Gmail change needs attention',
    )
  },
}

export const MailboxRefreshFailedWithCache: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxRefreshError },
  render: renderLinear('refresh-cache-error'),
}

export const OfflineCache: Story = {
  parameters: { mailrovers: storybookScenarios.disconnected },
  render: renderLinear('offline'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Offline cache retained/)).toBeVisible()
  },
}

export const Refreshing: Story = {
  parameters: { mailrovers: storybookScenarios.refreshing },
  render: renderLinear('refreshing'),
}

export const RefreshFailed: Story = {
  parameters: { mailrovers: storybookScenarios.refreshFailed },
  render: renderLinear('refresh-failed'),
}

export const RefreshComplete: Story = {
  parameters: { mailrovers: storybookScenarios.refreshComplete },
  render: renderLinear('refresh-complete'),
}

export const RefreshCancelled: Story = {
  parameters: { mailrovers: storybookScenarios.refreshCancelled },
  render: renderLinear('refresh-cancelled'),
}

export const RefreshDeferred: Story = {
  parameters: { mailrovers: storybookScenarios.refreshDeferred },
  render: renderLinear('refresh-deferred'),
}

export const RefreshAlreadyActive: Story = {
  parameters: { mailrovers: storybookScenarios.refreshAlreadyActive },
  render: renderLinear('refresh-active'),
}

export const ArchiveUndo: Story = {
  parameters: { mailrovers: storybookScenarios.archiveUndo },
  render: renderLinear('archive-undo'),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Conversation archived.')).toBeVisible()
    await expect(
      await within(canvasElement).findByRole('button', { name: 'Undo archive' }),
    ).toBeVisible()
  },
}
