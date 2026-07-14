import type { DesktopBridge } from '@mailrovers/mail-contracts'

declare global {
  interface Window {
    mailrovers: DesktopBridge
  }
}
export {}
