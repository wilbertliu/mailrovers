import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { App } from './App.js'
import { openLaunchConversation } from './storybook/story-helpers.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/AI',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

async function openAiSettings(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const body = within(canvasElement.ownerDocument.body)
  await userEvent.click(await canvas.findByRole('button', { name: 'AI provider' }))
  const dialog = await body.findByRole('dialog')
  await expect(await within(dialog).findByRole('heading', { name: 'OpenAI API key' })).toBeVisible()
  return { canvas, dialog: within(dialog), body }
}

export const SettingsConfigured: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettings },
  play: async ({ canvasElement }) => {
    const { dialog } = await openAiSettings(canvasElement)
    await expect(
      await dialog.findByText(/If you already saved one, this replaces it/),
    ).toBeVisible()
    await expect(await dialog.findByText('How we store your key')).toBeVisible()
    await expect(
      await dialog.findByPlaceholderText('Enter a new key to replace the stored one'),
    ).toBeVisible()
    await expect(await dialog.findByRole('button', { name: 'Replace API key' })).toBeDisabled()
  },
}

export const SettingsFailedToLoad: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsError },
  play: async ({ canvasElement }) => {
    const { dialog } = await openAiSettings(canvasElement)
    await expect(await dialog.findByRole('alert')).toHaveTextContent('Could not load AI settings.')
  },
}

export const SettingsLoading: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsLoading },
  play: async ({ canvasElement }) => {
    const { dialog } = await openAiSettings(canvasElement)
    await expect(await dialog.findByText('Loading AI settings…')).toBeVisible()
  },
}

export const SettingsNotConfigured: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsUnconfigured },
  play: async ({ canvasElement }) => {
    const { dialog } = await openAiSettings(canvasElement)
    await expect(await dialog.findByRole('button', { name: 'Save API key' })).toBeDisabled()
    await expect(await dialog.findByPlaceholderText('sk-…')).toBeVisible()
  },
}

export const SettingsSaving: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsSaving },
  play: async ({ canvasElement }) => {
    const { dialog } = await openAiSettings(canvasElement)
    await userEvent.type(await dialog.findByLabelText('API key'), 'sk-test-key')
    await userEvent.click(await dialog.findByRole('button', { name: 'Replace API key' }))
    await expect(await dialog.findByRole('button', { name: 'Saving…' })).toBeDisabled()
  },
}

export const SettingsSaveFailed: Story = {
  parameters: { mailrovers: storybookScenarios.aiSettingsSaveFailed },
  play: async ({ canvasElement }) => {
    const { dialog } = await openAiSettings(canvasElement)
    await userEvent.type(await dialog.findByLabelText('API key'), 'sk-test-key')
    await userEvent.click(await dialog.findByRole('button', { name: 'Replace API key' }))
    await expect(await dialog.findByRole('alert')).toHaveTextContent(
      'The AI provider settings could not be saved.',
    )
  },
}

async function startSummary(canvasElement: HTMLElement) {
  const canvas = await openLaunchConversation(canvasElement)
  await userEvent.click(await canvas.findByRole('button', { name: 'Summarize conversation' }))
  return canvas
}

export const SummaryStreaming: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryStreaming },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(
      await canvas.findByRole('region', { name: 'Conversation summary' }),
    ).toHaveTextContent(/Maya completed the launch review/)
    await expect(await canvas.findByRole('button', { name: 'Cancel' })).toBeVisible()
  },
}

export const SummaryComplete: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryComplete },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(
      await canvas.findByRole('region', { name: 'Conversation summary' }),
    ).toHaveTextContent(/asked Alex to verify the attached PDF/)
    await expect(await canvas.findByRole('button', { name: 'Regenerate' })).toBeVisible()
  },
}

export const SummaryFailed: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryError },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI provider is temporarily unavailable.',
    )
  },
}

export const SummaryCouldNotStart: Story = {
  parameters: { mailrovers: storybookScenarios.aiSummaryStartFailed },
  play: async ({ canvasElement }) => {
    const canvas = await startSummary(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The AI summary could not be started.',
    )
  },
}
