import type { SyncLeaseFence } from '@mailrovers/mail-application'

export type RenewFence = () => Promise<SyncLeaseFence>

/**
 * Renew the sync lease once, then run a domain write with the fresh fence.
 * Fence acquisition stays here so phase logic only expresses store mutations.
 */
export async function withFence<T>(
  renew: RenewFence,
  write: (fence: SyncLeaseFence) => Promise<T>,
): Promise<T> {
  const fence = await renew()
  return write(fence)
}
