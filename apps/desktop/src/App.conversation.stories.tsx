import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { openLaunchConversation } from './storybook/story-helpers.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/Conversation',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

async function selectLaunchConversation(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await userEvent.click(
    await canvas.findByRole('button', { name: /Launch checklist and final copy/i }),
  )
  return canvas
}

export const Loading: Story = {
  parameters: { mailrovers: storybookScenarios.conversationLoading },
  play: async ({ canvasElement }) => {
    const canvas = await selectLaunchConversation(canvasElement)
    await expect(await canvas.findByText('Loading conversation…')).toBeVisible()
  },
}

export const FailedToOpen: Story = {
  parameters: { mailrovers: storybookScenarios.conversationError },
  play: async ({ canvasElement }) => {
    const canvas = await selectLaunchConversation(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Unable to open this conversation.',
    )
  },
}

export const MessageBodyLoading: Story = {
  parameters: { mailrovers: storybookScenarios.messageBodyLoading },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await expect(await canvas.findByText('Loading message…')).toBeVisible()
  },
}

export const NoReadableMessageBody: Story = {
  parameters: { mailrovers: storybookScenarios.messageWithoutReadableBody },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await expect(await canvas.findByText('This message has no readable body.')).toBeVisible()
  },
}

export const HtmlMessageBody: Story = {
  parameters: { mailrovers: storybookScenarios.htmlMessageBody },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await expect(await canvas.findByTitle('Message from maya@example.com')).toBeVisible()
  },
}

export const AttachmentExporting: Story = {
  parameters: { mailrovers: storybookScenarios.attachmentExporting },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Export' }))
    await expect(await canvas.findByRole('button', { name: 'Exporting…' })).toBeDisabled()
  },
}

export const AttachmentExported: Story = {
  parameters: { mailrovers: storybookScenarios.conversation },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Export' }))
    await expect(await canvas.findByText('launch-checklist.pdf exported.')).toBeVisible()
  },
}

export const AttachmentExportCancelled: Story = {
  parameters: { mailrovers: storybookScenarios.attachmentExportCancelled },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Export' }))
    await expect(await canvas.findByText('Export cancelled.')).toBeVisible()
  },
}

export const AttachmentExportFailed: Story = {
  parameters: { mailrovers: storybookScenarios.attachmentExportFailed },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Export' }))
    await expect(await canvas.findByText('The attachment could not be exported.')).toBeVisible()
  },
}

export const AttachmentUnavailable: Story = {
  parameters: { mailrovers: storybookScenarios.attachmentUnavailable },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Export' })).toBeDisabled()
  },
}
