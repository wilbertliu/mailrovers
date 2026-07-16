import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { openLaunchConversation } from './storybook/story-helpers.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/Workspace',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const PopulatedInbox: Story = {
  parameters: { mailrovers: storybookScenarios.workspace },
}

export const EmptyInbox: Story = {
  parameters: { mailrovers: storybookScenarios.emptyInbox },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('No conversations in this view.'),
    ).toBeVisible()
  },
}

export const InboxLoading: Story = {
  parameters: { mailrovers: storybookScenarios.inboxLoading },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Loading mail…')).toBeVisible()
  },
}

export const InboxFailedToLoad: Story = {
  parameters: { mailrovers: storybookScenarios.inboxError },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Unable to load local mail.',
    )
  },
}

export const LabelsLoading: Story = {
  parameters: { mailrovers: storybookScenarios.labelsLoading },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Loading labels…')).toBeVisible()
  },
}

export const LabelsFailedToLoad: Story = {
  parameters: { mailrovers: storybookScenarios.labelsError },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Mail' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /Inbox/ })).not.toBeInTheDocument()
  },
}

export const ConversationSelected: Story = {
  parameters: { mailrovers: storybookScenarios.conversation },
  play: async ({ canvasElement }) => {
    await openLaunchConversation(canvasElement)
  },
}

export const SearchResults: Story = {
  parameters: { mailrovers: storybookScenarios.searchResults },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Search mail' }),
      'launch{Enter}',
    )
    await expect(await canvas.findByRole('heading', { name: 'Search' })).toBeVisible()
    await expect(await canvas.findByText(/attached launch checklist/i)).toBeVisible()
  },
}

export const LocalDrafts: Story = {
  parameters: { mailrovers: storybookScenarios.drafts },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /Local drafts/ }))
    await expect(await canvas.findByRole('heading', { name: 'Local drafts' })).toBeVisible()
  },
}

export const NoLocalDrafts: Story = {
  parameters: { mailrovers: storybookScenarios.emptyDrafts },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Local drafts' }))
    await expect(await canvas.findByText('No local drafts.')).toBeVisible()
  },
}

export const DraftsLoading: Story = {
  parameters: { mailrovers: storybookScenarios.draftsLoading },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Local drafts' }))
    await expect(await canvas.findByRole('heading', { name: 'Local drafts' })).toBeVisible()
    await expect(await canvas.findByText('0 saved on this Mac')).toBeVisible()
  },
}

export const CommandNeedsReview: Story = {
  parameters: { mailrovers: storybookScenarios.commandIssue },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'Confirm whether this message was sent',
    )
  },
}

export const GmailChangeNeedsReview: Story = {
  parameters: { mailrovers: storybookScenarios.genericCommandIssue },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      'A Gmail change needs attention',
    )
  },
}

export const CommandReviewDismissed: Story = {
  parameters: { mailrovers: storybookScenarios.commandIssueResolved },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
}

export const MailboxRefreshFailedWithCache: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxRefreshError },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Couldn't refresh mailboxes")).toBeVisible()
    await expect(
      await within(canvasElement).findByText('Showing the last available mailbox data.'),
    ).toBeVisible()
  },
}

export const OfflineCache: Story = {
  parameters: { mailrovers: storybookScenarios.disconnected },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/Offline cache retained/)).toBeVisible()
  },
}

export const Refreshing: Story = {
  parameters: { mailrovers: storybookScenarios.refreshing },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Refresh' }))
    await expect(await canvas.findByRole('button', { name: 'Refreshing…' })).toBeDisabled()
  },
}

export const RefreshFailed: Story = {
  parameters: { mailrovers: storybookScenarios.refreshFailed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Refresh' }))
    await expect(await canvas.findByText(/Gmail could not be reached/)).toBeVisible()
  },
}

export const RefreshComplete: Story = {
  parameters: { mailrovers: storybookScenarios.refreshComplete },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Refresh' }))
    await expect(await canvas.findByText('Refresh complete.')).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Refresh' })).toBeEnabled()
  },
}

export const RefreshCancelled: Story = {
  parameters: { mailrovers: storybookScenarios.refreshCancelled },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Refresh' }))
    await expect(await canvas.findByText('Refresh cancelled.')).toBeVisible()
  },
}

export const RefreshDeferred: Story = {
  parameters: { mailrovers: storybookScenarios.refreshDeferred },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Refresh' }))
    await expect(await canvas.findByText(/Refresh deferred until/)).toBeVisible()
  },
}

export const RefreshAlreadyActive: Story = {
  parameters: { mailrovers: storybookScenarios.refreshAlreadyActive },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Refresh' }))
    await expect(await canvas.findByText('Refresh already active.')).toBeVisible()
  },
}

export const ArchiveUndo: Story = {
  parameters: { mailrovers: storybookScenarios.archiveUndo },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Archive' }))
    await expect(await canvas.findByText('Conversation archived.')).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Undo archive' })).toBeVisible()
  },
}
