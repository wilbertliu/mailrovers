import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { App } from './App.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'

const meta = {
  title: 'Flows/Mailbox gate',
  component: App,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const Opening: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxOpening },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('img', { name: 'MailRovers' }, { timeout: 3000 }),
    ).toBeVisible()
  },
}

export const FailedToOpen: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxError },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent(
      "Couldn't open your local mailbox.",
    )
  },
}

export const Retrying: Story = {
  parameters: { mailrovers: storybookScenarios.mailboxRetrying },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Retry' }))
    await expect(await canvas.findByRole('img', { name: 'MailRovers' }, { timeout: 3000 })).toBeVisible()
  },
}

export const NoAccountConnected: Story = {
  parameters: { mailrovers: storybookScenarios.noAccounts },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Before you connect' })).toBeVisible()
    await expect(canvasElement.querySelector('.startup-splash-logo')).toBeNull()
    await expect(canvasElement.ownerDocument.getElementById('mailrovers-boot-splash')).toBeNull()
  },
}

export const WaitingForGoogle: Story = {
  parameters: { mailrovers: storybookScenarios.connecting },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await expect(await canvas.findByRole('button', { name: 'Waiting for Google…' })).toBeDisabled()
  },
}

export const CancellingGoogleConnection: Story = {
  parameters: { mailrovers: storybookScenarios.cancellingConnection },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Cancel' }))
    await expect(await canvas.findByRole('button', { name: 'Cancelling…' })).toBeDisabled()
  },
}

export const AddAnotherAccount: Story = {
  parameters: { mailrovers: storybookScenarios.addAccount },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: /MailRovers/i }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Add Gmail account' }))
    await expect(await canvas.findByRole('heading', { name: 'Before you connect' })).toBeVisible()
    await expect(await canvas.findByRole('button', { name: 'Back' })).toBeVisible()
    await userEvent.click(await canvas.findByRole('button', { name: 'Back' }))
    await expect(await canvas.findByRole('textbox', { name: 'Search mail' })).toBeVisible()
  },
}

export const GoogleConnectionFailed: Story = {
  parameters: { mailrovers: storybookScenarios.connectFailed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await waitFor(async () =>
      expect(await body.findByText('Gmail connection failed')).toBeVisible(),
    )
  },
}

export const GoogleCancellationFailed: Story = {
  parameters: { mailrovers: storybookScenarios.cancelConnectionFailed },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Cancel' }))
    await waitFor(async () =>
      expect(await body.findByText("Couldn't cancel connection")).toBeVisible(),
    )
    await expect(await canvas.findByRole('button', { name: 'Cancel' })).toBeEnabled()
  },
}

export const GoogleConnectionSucceeded: Story = {
  parameters: { mailrovers: storybookScenarios.connectionSucceeded },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect Gmail' }))
    await expect(await canvas.findByRole('heading', { name: 'Gmail connected' })).toBeVisible()
    await expect(await canvas.findByRole('textbox', { name: 'Search mail' })).toBeVisible()
    await expect(await canvas.findByText('Importing older mail')).toBeVisible()
  },
}
