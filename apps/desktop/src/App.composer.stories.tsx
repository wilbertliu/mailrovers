import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { App } from './App.js'
import { openLaunchConversation } from './storybook/story-helpers.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/Composer',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const NewMessage: Story = {
  parameters: { mailrovers: storybookScenarios.composer },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Write email' }))
    await expect(await canvas.findByRole('region', { name: 'New message' })).toBeVisible()
  },
}

export const Reply: Story = {
  parameters: { mailrovers: storybookScenarios.conversation },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Reply' }))
    await expect(await canvas.findByRole('region', { name: 'Reply' })).toBeVisible()
  },
}

export const AiReplyReady: Story = {
  parameters: { mailrovers: storybookScenarios.aiReplyComplete },
  play: async ({ canvasElement }) => {
    const canvas = await openLaunchConversation(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Reply' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Draft with AI' }))
    await expect(await canvas.findByRole('region', { name: 'AI reply suggestion' })).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Use suggestion' })).toBeVisible()
  },
}

export const ExistingDraft: Story = {
  parameters: { mailrovers: storybookScenarios.drafts },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /Local drafts/ }))
    await userEvent.click(
      await canvas.findByRole('button', { name: /Re: Launch checklist and final copy/ }),
    )
    await expect(await canvas.findByRole('region', { name: 'Reply' })).toBeVisible()
    await expect(await canvas.findByText('Draft 3')).toBeVisible()
  },
}

export const Autosaving: Story = {
  parameters: { mailrovers: storybookScenarios.composerSaving },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Write email' }))
    await userEvent.type(await canvas.findByLabelText('Subject'), 'A new local draft')
    await waitFor(async () => expect(await canvas.findByText('Saving locally…')).toBeVisible(), {
      timeout: 3_000,
    })
  },
}

export const Autosaved: Story = {
  parameters: { mailrovers: storybookScenarios.composer },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Write email' }))
    await userEvent.type(await canvas.findByLabelText('Subject'), 'A saved local draft')
    await waitFor(async () => expect(await canvas.findByText('Saved locally')).toBeVisible(), {
      timeout: 3_000,
    })
  },
}

export const AutosaveFailed: Story = {
  parameters: { mailrovers: storybookScenarios.composerSaveFailed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Write email' }))
    await userEvent.type(await canvas.findByLabelText('Subject'), 'A draft that cannot save')
    await waitFor(
      async () =>
        expect(await canvas.findByText('Could not save. Keep this window open.')).toBeVisible(),
      { timeout: 3_000 },
    )
  },
}

export const SendPending: Story = {
  parameters: { mailrovers: storybookScenarios.composerSending },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Write email' }))
    await userEvent.type(await canvas.findByLabelText('To'), 'maya@example.com')
    await userEvent.click(await canvas.findByRole('button', { name: 'Send' }))
    await expect(await canvas.findByRole('region', { name: 'New message' })).toBeVisible()
    await expect(await canvas.findByText('Saved locally')).toBeVisible()
  },
}

export const SendFailed: Story = {
  parameters: { mailrovers: storybookScenarios.composerSendFailed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Write email' }))
    await userEvent.type(await canvas.findByLabelText('To'), 'maya@example.com')
    await userEvent.click(await canvas.findByRole('button', { name: 'Send' }))
    await expect(await canvas.findByText('Could not save. Keep this window open.')).toBeVisible()
  },
}

async function startAiReply(canvasElement: HTMLElement) {
  const canvas = await openLaunchConversation(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: 'Reply' }))
  await userEvent.click(await canvas.findByRole('button', { name: 'Draft with AI' }))
  return canvas
}

export const AiReplyStreaming: Story = {
  parameters: { mailrovers: storybookScenarios.aiReplyStreaming },
  play: async ({ canvasElement }) => {
    const canvas = await startAiReply(canvasElement)
    await expect(
      await canvas.findByRole('region', { name: 'AI reply suggestion' }),
    ).toHaveTextContent(/reviewed the checklist/)
    await expect(await canvas.findByRole('button', { name: 'Cancel' })).toBeVisible()
  },
}

export const AiReplyFailed: Story = {
  parameters: { mailrovers: storybookScenarios.aiReplyError },
  play: async ({ canvasElement }) => {
    const canvas = await startAiReply(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI provider could not draft a reply.',
    )
  },
}

export const AiReplyCouldNotStart: Story = {
  parameters: { mailrovers: storybookScenarios.aiReplyStartFailed },
  play: async ({ canvasElement }) => {
    const canvas = await startAiReply(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI reply could not be started.',
    )
  },
}

export const AiReplyAccepted: Story = {
  parameters: { mailrovers: storybookScenarios.aiReplyComplete },
  play: async ({ canvasElement }) => {
    const canvas = await startAiReply(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Use suggestion' }))
    await expect(await canvas.findByLabelText('Message')).toHaveValue(
      'Thanks, Maya. I reviewed the final checklist and everything looks ready. I will schedule the announcement this afternoon.',
    )
    await expect(
      canvas.queryByRole('region', { name: 'AI reply suggestion' }),
    ).not.toBeInTheDocument()
  },
}

export const AiReplyDiscarded: Story = {
  parameters: { mailrovers: storybookScenarios.aiReplyComplete },
  play: async ({ canvasElement }) => {
    const canvas = await startAiReply(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Discard' }))
    await expect(
      canvas.queryByRole('region', { name: 'AI reply suggestion' }),
    ).not.toBeInTheDocument()
    await expect(await canvas.findByRole('button', { name: 'Draft with AI' })).toBeVisible()
  },
}
