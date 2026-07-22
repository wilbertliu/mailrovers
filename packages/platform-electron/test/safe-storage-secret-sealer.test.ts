import { describe, expect, it } from 'vitest'
import {
  assertOsProtectedSafeStorage,
  SECRET_STORAGE_UNAVAILABLE_CODE,
  STRONG_LINUX_SAFE_STORAGE_BACKENDS,
} from '../src/safe-storage-secret-sealer.js'

describe('assertOsProtectedSafeStorage', () => {
  it('rejects when async encryption is unavailable on every platform', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(() =>
        assertOsProtectedSafeStorage({
          encryptionAvailable: false,
          platform,
          selectedBackend: platform === 'linux' ? 'gnome_libsecret' : undefined,
        }),
      ).toThrow(/Operating-system credential encryption is unavailable/)
    }
  })

  it('allows macOS and Windows when encryption is available without inspecting a backend', () => {
    expect(() =>
      assertOsProtectedSafeStorage({
        encryptionAvailable: true,
        platform: 'darwin',
      }),
    ).not.toThrow()
    expect(() =>
      assertOsProtectedSafeStorage({
        encryptionAvailable: true,
        platform: 'win32',
        selectedBackend: 'basic_text',
      }),
    ).not.toThrow()
  })

  it('allows only documented OS-keyring Linux backends', () => {
    for (const selectedBackend of STRONG_LINUX_SAFE_STORAGE_BACKENDS) {
      expect(() =>
        assertOsProtectedSafeStorage({
          encryptionAvailable: true,
          platform: 'linux',
          selectedBackend,
        }),
      ).not.toThrow()
    }
  })

  it('rejects Linux basic_text even when encryption reports available', () => {
    expect(() =>
      assertOsProtectedSafeStorage({
        encryptionAvailable: true,
        platform: 'linux',
        selectedBackend: 'basic_text',
      }),
    ).toThrow(
      expect.objectContaining({
        code: SECRET_STORAGE_UNAVAILABLE_CODE,
        message: expect.stringContaining('basic_text'),
      }),
    )
  })

  it('rejects Linux unknown, missing, and non-allowlisted backends', () => {
    for (const selectedBackend of [undefined, 'unknown', 'custom_store'] as const) {
      expect(() =>
        assertOsProtectedSafeStorage({
          encryptionAvailable: true,
          platform: 'linux',
          ...(selectedBackend === undefined ? {} : { selectedBackend }),
        }),
      ).toThrow(/Operating-system credential encryption is unavailable/)
    }
  })
})
