const Database = require('better-sqlite3')

const database = new Database(':memory:')
database.close()

console.log(
  `better-sqlite3 loaded with Electron ${process.versions.electron}, Node ${process.version}, ABI ${process.versions.modules}`,
)
