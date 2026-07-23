import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { featureFlags } from './feature-flags.js'
import { openLaunchConversation, submitSearch } from './storybook/story-helpers.js'
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
    await expect(await canvas.findByRole('heading', { name: /Inbox/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /Inbox/ })).not.toBeInTheDocument()
  },
}

export const ConversationSelected: Story = {
  parameters: { mailrovers: storybookScenarios.conversation },
  play: async ({ canvasElement }) => {
    await openLaunchConversation(canvasElement)
  },
}

export const MailboxSwitchResetsWorkspaceState: Story = {
  parameters: { mailrovers: storybookScenarios.workspace },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: /Travel/ }))
    await expect(await canvas.findByRole('heading', { name: /Travel/ })).toBeVisible()
    await submitSearch(canvasElement)
    await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Reply' }))
    await expect(await canvas.findByRole('region', { name: 'Reply' })).toBeVisible()
    await userEvent.click(await canvas.findByRole('button', { name: /MailRovers/ }))
    await userEvent.click(await body.findByRole('menuitemradio', { name: 'alex@studio.example' }))
    await expect(await canvas.findByRole('heading', { name: /Inbox/ })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Search' })).not.toBeInTheDocument()
    await expect(canvas.queryByRole('region', { name: 'Reply' })).not.toBeInTheDocument()
  },
}

export const SearchResults: Story = {
  parameters: { mailrovers: storybookScenarios.searchResults },
  play: async ({ canvasElement }) => {
    const canvas = await submitSearch(canvasElement)
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
    await expect(await within(canvasElement).findByText('Refresh failed')).toBeVisible()
    await expect(await within(canvasElement).findByText('Using saved mailbox data')).toBeVisible()
  },
}

export const OfflineCache: Story = {
  parameters: { mailrovers: storybookScenarios.disconnected },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('textbox', { name: 'Search mail' })).toBeVisible()
    await expect(await canvas.findByText(/Offline cache retained/)).toBeVisible()
  },
}

export const ImportingOlderMail: Story = {
  parameters: { mailrovers: storybookScenarios.connectionSucceeded },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await expect(await canvas.findByRole('textbox', { name: 'Search mail' })).toBeVisible()
    await userEvent.click(await canvas.findByRole('button', { name: 'Importing email' }))
    await expect(await body.findByRole('button', { name: 'Pause import' })).toBeVisible()
  },
}

export const ArchiveUndo: Story = {
  tags: featureFlags.readerThreadActions ? undefined : ['!test'],
  parameters: { mailrovers: storybookScenarios.archiveUndo },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Archive' }))
    await expect(await canvas.findByText('Conversation archived.')).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Undo archive' })).toBeVisible()
  },
}

