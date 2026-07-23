/**
 * MailRovers desktop renderer feature flags.
 *
 * Maintainer guide:
 * - Toggle defaults in `featureFlags` below.
 * - Import flags from this module only — do not duplicate booleans in components.
 * - When adding a flag, document what UI/behavior it gates and any Storybook stories
 *   that should skip while the flag is off.
 */
export const featureFlags = {
  /**
   * Conversation reader header: mark read, archive, star, add label.
   * @see apps/desktop/src/features/conversation/ConversationReader.tsx
   * @see apps/desktop/src/App.workspace.stories.tsx (`ArchiveUndo` skips when false)
   */
  readerThreadActions: false,
} as const satisfies Record<string, boolean>

export type FeatureFlag = keyof typeof featureFlags
