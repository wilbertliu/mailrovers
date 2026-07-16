import type { StorybookScenario } from '../src/storybook/storybook-scenarios.js'
import { describe, expect, it } from 'vitest'
import { failure, success, storybookScenarios } from '../src/storybook/storybook-scenarios.js'
import { createStorybookBridge } from '../src/storybook/mock-desktop-bridge.js'
import { storybookFixtures, storybookIds } from '../src/storybook/storybook-fixtures.js'

describe('Storybook desktop bridge', () => {
  it('serves contract-shaped fixture data without Electron', async () => {
    const bridge = createStorybookBridge(storybookScenarios.workspace)

    await expect(
      bridge.v1.listMailboxes({ requestId: storybookFixtures.syncReceipt.requestId }),
    ).resolves.toEqual({
      ok: true,
      value: [storybookFixtures.primaryMailbox, storybookFixtures.secondaryMailbox],
    })
    await expect(
      bridge.v1.getConversation({
        requestId: storybookFixtures.syncReceipt.requestId,
        mailboxId: storybookFixtures.primaryMailbox.id,
        conversationId: storybookFixtures.launchConversation.id,
      }),
    ).resolves.toEqual({ ok: true, value: storybookFixtures.launchConversation })
  })

  it('advances response sequences and keeps returning the final state', async () => {
    const recoveredMailboxes = [storybookFixtures.primaryMailbox]
    const scenario = {
      ...storybookScenarios.workspace,
      responses: {
        listMailboxes: [
          failure('The database is temporarily unavailable.'),
          success(recoveredMailboxes),
        ],
      },
    } satisfies StorybookScenario
    const bridge = createStorybookBridge(scenario)
    const input = { requestId: storybookFixtures.syncReceipt.requestId }

    await expect(bridge.v1.listMailboxes(input)).resolves.toMatchObject({ ok: false })
    await expect(bridge.v1.listMailboxes(input)).resolves.toEqual({
      ok: true,
      value: recoveredMailboxes,
    })
    await expect(bridge.v1.listMailboxes(input)).resolves.toEqual({
      ok: true,
      value: recoveredMailboxes,
    })
  })

  it('overrides nested renderer requests without changing production modules', async () => {
    const scenario = {
      ...storybookScenarios.workspace,
      responses: { getMessageBody: failure('The body is unavailable.') },
    } satisfies StorybookScenario
    const bridge = createStorybookBridge(scenario)

    await expect(
      bridge.v1.getMessageBody({
        requestId: storybookFixtures.syncReceipt.requestId,
        mailboxId: storybookFixtures.primaryMailbox.id,
        conversationId: storybookFixtures.launchConversation.id,
        messageId: storybookIds.launchMessage,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: 'The body is unavailable.' },
    })
  })
})
