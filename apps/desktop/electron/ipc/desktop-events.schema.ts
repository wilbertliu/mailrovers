import { z } from 'zod'
import { aiStreamEventSchema } from './ai.schema.js'
import { desktopEventSchema as syncEventSchema } from './mailboxes.schema.js'

export const desktopEventSchema = z.union([syncEventSchema, aiStreamEventSchema])
export type DesktopIpcEvent = z.output<typeof desktopEventSchema>
