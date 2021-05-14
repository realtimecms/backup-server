const fs = require('fs')
const archiver = require('archiver')
const stream = require('stream')
const util = require('util')
const dump = require('@live-change/db-client/lib/dump.js')
const prettyBytes = require('pretty-bytes')
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
    if(!stream.write(code+'\n')) {
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

async function backup(outputStream) {
  const archive = archiver('tar', { gzip: true, zlib: { level: 9 } })
  archive.pipe(outputStream)

  const dbPass = stream.PassThrough()
  archive.append(dbPass, { name: 'db.json' })
  await writeDbBackup(dbPass)

  const version = await fs.promises.readFile('../../version', { encoding: 'utf8' }).catch(e => 'unknown')
  const info = {
    version: version,
    hostname: os.hostname(),
    directory: path.resolve('../..')
  }
  archive.append(JSON.stringify(info, null, "  " ), { name: 'info.json' })

  archive.directory("../../storage", "storage")

  await archive.finalize()
}

async function createBackup(backupPath = currentBackupPath()) {
  const output = fs.createWriteStream(backupPath+'.tmp')
  await backup(output)
  output.close();
  await fs.promises.rename(backupPath + '.tmp', backupPath + '.tar.gz')
}

module.exports = { backup, createBackup, currentBackupPath }