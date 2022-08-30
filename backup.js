const fs = require('fs')
const fse = require('fs-extra')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const dump = require('@live-change/db-client/lib/dump.js')
const { once } = require('events')
const os = require("os")
const path = require('path')

function currentBackupPath(backupsDir = '../../backups/') {
  const dateString = new Date().toISOString().slice(0,-1).replace(/[T:\\.-]/gi, '_')
  return `${backupsDir}/${dateString.substring(0, dateString.length - 1)}`
}

async function writeDbBackup(stream) {
  let drainPromise
  async function write(object) {
    const code = JSON.stringify(object)
    if(!stream.write(code + '\n')) {
      if(!drainPromise) drainPromise = once(stream, 'drain')
      await drainPromise
      drainPromise = null
    }
  }
  await dump({
    serverUrl: process.env.DB_URL || 'http://localhost:9417/api/ws',
    db: process.env.DB_NAME,
    structure: true,
    verbose: true
  },
      (method, ...args) => write({ type: 'request', method, parameters: args }),
      sync = () => write({ type: 'sync' })
  )
  stream.end()
}

async function createBackup(backupPath = currentBackupPath()) {
  await fs.promises.mkdir(backupPath)

  const dbStream = fs.createWriteStream(path.resolve(backupPath, 'db.json'))
  await writeDbBackup(dbStream)

  const version = await fs.promises.readFile('../../version', { encoding: 'utf8' }).catch(e => 'unknown')
  const info = {
    version: version,
    hostname: os.hostname(),
    directory: path.resolve('../..')
  }

  await fs.promises.writeFile(path.resolve(backupPath, 'info.json'), JSON.stringify(info, null, '  '))

  await fse.copy("../../storage", path.resolve(backupPath, "storage"))

  const command = `tar -zcf ${backupPath}.tar.gz.tmp storage info.json db.json`
  console.log("EXEC TAR COMMAND:", command)
  await exec(command, { cwd: backupPath })

  await fs.promises.rename(backupPath + '.tar.gz.tmp', backupPath + '.tar.gz')

  await fse.remove(backupPath)
}

module.exports = {  createBackup, currentBackupPath }
