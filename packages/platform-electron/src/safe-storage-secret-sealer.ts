import type { SecretSealer } from '@mailrovers/mail-application'
import { safeStorage } from 'electron'

export class ElectronSafeStorageSecretSealer implements SecretSealer {
  async seal(plainText: string): Promise<Uint8Array> {
    if (!(await safeStorage.isAsyncEncryptionAvailable()))
      throw new Error('Operating-system credential encryption is unavailable')
    return new Uint8Array(await safeStorage.encryptStringAsync(plainText))
  }

  async unseal(cipherText: Uint8Array): Promise<string> {
    if (!(await safeStorage.isAsyncEncryptionAvailable()))
      throw new Error('Operating-system credential encryption is unavailable')
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(cipherText))
    return decrypted.result
  }
}
