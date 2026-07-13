import type { DesktopEvent } from '@mailrovers/mail-contracts'
import type { WebContents } from 'electron'
import { channels } from './channels.js'
import { desktopEventSchema } from './mailboxes.schema.js'

export class DesktopEventBus {
  private target?: WebContents | undefined

  attach(target: WebContents): void {
    this.target = target
  }

  detach(target: WebContents): void {
    if (this.target === target) this.target = undefined
  }

  publish(event: DesktopEvent): void {
    const target = this.target
    if (!target || target.isDestroyed()) return
    target.send(channels.event, desktopEventSchema.parse(event))
  }
}
