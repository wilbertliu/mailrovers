import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import logoSrc from './assets/logo.png?inline'
import { createStartupScreenDocument } from './startup-screen-document.js'
import { storybookScenarios } from './storybook/storybook-scenarios.js'
import './storybook/startup-screen.css'

const startupScreenDocument = createStartupScreenDocument(logoSrc)

function StartupScreen() {
  return (
    <iframe
      className="startup-screen-frame"
      srcDoc={startupScreenDocument}
      title="MailRovers startup"
    />
  )
}

const meta = {
  title: 'Flows/Startup',
  component: StartupScreen,
  parameters: {
    layout: 'fullscreen',
    mailrovers: storybookScenarios.workspace,
  },
} satisfies Meta<typeof StartupScreen>

export default meta
type Story = StoryObj<typeof meta>

export const OpeningMailbox: Story = {
  play: async ({ canvasElement }) => {
    const frame = await within(canvasElement).findByTitle('MailRovers startup')
    if (!(frame instanceof HTMLIFrameElement)) throw new Error('Startup story iframe is missing')

    const documentBody = await waitFor(() => {
      const body = frame.contentDocument?.body
      if (body === undefined || body === null) throw new Error('Startup document is not loaded')
      return body
    })
    await expect(within(documentBody).getByRole('img', { name: 'MailRovers' })).toBeVisible()
  },
}
