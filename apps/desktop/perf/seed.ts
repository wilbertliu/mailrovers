import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, openDatabase } from '@mailrovers/mail-store-sqlite'
import { writeRedactedJsonLine } from '@mailrovers/platform-electron'
import { seedMailboxFixture } from '@mailrovers/test-support'
const dir = join(process.cwd(), 'artifacts')
mkdirSync(dir, { recursive: true })
const path = join(dir, 'm1-fixture.sqlite')
const db = openDatabase(path)
migrate(db)
writeRedactedJsonLine({ path, ...seedMailboxFixture(db) })
db.close()
