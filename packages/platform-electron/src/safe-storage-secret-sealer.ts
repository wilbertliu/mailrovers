import type { SecretSealer } from '@mailrovers/mail-application'
import { safeStorage } from 'electron'

/** Linux backends Electron documents as OS secret-store backed. */
export const STRONG_LINUX_SAFE_STORAGE_BACKENDS = [
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
] as const

const strongLinuxBackendSet = new Set<string>(STRONG_LINUX_SAFE_STORAGE_BACKENDS)

export const SECRET_STORAGE_UNAVAILABLE_CODE = 'SECRET_STORAGE_UNAVAILABLE' as const

export function secretStorageUnavailableError(message: string): Error & {
  code: typeof SECRET_STORAGE_UNAVAILABLE_CODE
} {
  return Object.assign(new Error(message), { code: SECRET_STORAGE_UNAVAILABLE_CODE })
}

/**
 * Enforces OS-keychain-backed secret storage.
 * On Linux, `isAsyncEncryptionAvailable()` can be true while Electron selected
 * `basic_text` (hardcoded plaintext password). Reject that and any non-allowlisted backend.
 * On macOS/Windows, Keychain/DPAPI apply when encryption is available; backend inspection is Linux-only.
 */
export function assertOsProtectedSafeStorage(input: {
  encryptionAvailable: boolean
  platform: NodeJS.Platform
  selectedBackend?: string | undefined
}): void {
  if (!input.encryptionAvailable) {
    throw secretStorageUnavailableError('Operating-system credential encryption is unavailable')
  }

  if (input.platform !== 'linux') return

  const backend = input.selectedBackend
  if (backend !== undefined && strongLinuxBackendSet.has(backend)) return

  if (backend === 'basic_text') {
    throw secretStorageUnavailableError(
      'Operating-system credential encryption is unavailable because Electron selected the basic_text backend. Install and unlock a system keyring such as GNOME Keyring (libsecret) or KWallet, then restart MailRovers.',
    )
  }

  if (backend === 'unknown' || backend === undefined) {
    throw secretStorageUnavailableError(
      'Operating-system credential encryption is unavailable because the safeStorage backend is not ready. Wait until the app is ready, then retry.',
    )
  }

  throw secretStorageUnavailableError(
    `Operating-system credential encryption is unavailable because Electron selected an unsupported safeStorage backend (${backend}). MailRovers requires an OS keyring such as GNOME Keyring (libsecret) or KWallet.`,
  )
}

function selectedLinuxStorageBackend(): string | undefined {
  if (typeof safeStorage.getSelectedStorageBackend !== 'function') return undefined
  return safeStorage.getSelectedStorageBackend()
}

async function assertReadyForSecrets(): Promise<void> {
  assertOsProtectedSafeStorage({
    encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
    platform: process.platform,
    selectedBackend: process.platform === 'linux' ? selectedLinuxStorageBackend() : undefined,
  })
}

export class ElectronSafeStorageSecretSealer implements SecretSealer {
  async seal(plainText: string): Promise<Uint8Array> {
    await assertReadyForSecrets()
    return new Uint8Array(await safeStorage.encryptStringAsync(plainText))
  }

  async unseal(cipherText: Uint8Array): Promise<string> {
    await assertReadyForSecrets()
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(cipherText))
    return decrypted.result
  }
}
