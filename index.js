const express = require('express')
const basicAuth = require('express-basic-auth')
const app = express()
const fs = require('fs')
const { createBackup, currentBackupPath, removeOldBackups } = require('./backup.js')
const { restoreBackup } = require('./restore.js')
const backupServicePort = process.env.BACKUP_SERVICE_PORT || 8007

const { default: PQueue } = require('p-queue');
const progress = require("progress-stream")
const queue = new PQueue({ concurrency: 1 })

const TWENTY_FOUR_HOURS = 24 * 3600 * 1000
const TEN_MINUTES = 10 * 60 * 1000

let currentBackup = null

const backupsDir = '../../backups'

if(process.env.BACKUP_SERVER_USERNAME && process.env.BACKUP_SERVER_PASSWORD) {
  let users = {}
  users[process.env.BACKUP_SERVER_USERNAME] = process.env.BACKUP_SERVER_PASSWORD
  app.use(basicAuth({
    users,
    challenge: true,
    realm: 'backupServer',
  }))
}

function doBackup() {
  if(currentBackup) return currentBackup
  const path = currentBackupPath(backupsDir)
  const filename = path.slice(path.lastIndexOf('/')+1)
  currentBackup = {
    path, filename,
    promise: queue.add(async () => {
      await removeOldBackups(backupsDir, 10*TWENTY_FOUR_HOURS, 10)
      await createBackup(path)
    })
  }
  currentBackup.promise.then(done => {
    console.log("BACKUP CREATED!")
    fs.promises.writeFile(backupsDir + '/latest.txt', filename+'.tar.gz')
    currentBackup = null
  })
  return currentBackup
}

app.get('/backup/doBackup', async (req, res) => {
  if(currentBackup) {
    res.status(200).send('Backup in progress: ' + currentBackup.filename)
    return
  }
  await doBackup()
  res.status(200).send('Creating backup: '+currentBackup.filename)
})

app.get('/backup/latest', async (req, res) => {
  const latest = await fs.promises.readFile(backupsDir + '/latest.txt', { encoding: 'utf8' })
  res.status(200).send(`https://${req.get('host')}/backup/download/${latest}`)
})

app.get('/backup', async (req, res) => {
  try {
    const files = await fs.promises.readdir(backupsDir)
    let backupFiles = files.filter(file => file.endsWith('tar.gz'))
        .map(fileName => `https://${req.get('host')}/backup/download/${fileName}`)
        .reverse()
        .join('\n')

    res.status(200).header('Content-Type', 'text/plain').send(backupFiles)
  } catch(err) {
    console.log(err)
  }
})

app.get('/backup/download/:fileName', (req, res) => {
  const { fileName } = req.params
  const file = `${backupsDir}/${fileName}`
  res.status(200).header('Content-Disposition', `attachment; filename="${fileName}"`).download(file)
})

app.post('/backup/upload/:fileName', async (req, res) => {
  const { fileName } = req.params
  const file = `${backupsDir}/${fileName}`

  const size = +req.header('Content-Length')
  console.log("SIZE", size)

  const uploadProgress = progress({
    length: size,
    time: 600
  })
  req.pipe(uploadProgress)
  const fileStream = fs.createWriteStream(file)
  uploadProgress.pipe(fileStream)

  fileStream.on('finish', () => {
    res.status(200)
    res.send("" + uploadProgress.progress().transferred)
  })

  fileStream.on('error', error => {
    res.status(503)
    res.send("Error " + error.toString())
  })
})

let restoringBackup = false
app.post('/restore/:fileName', async (req, res) => {
  const { fileName } = req.params
  throw new Error('not implemented')
  if(restoringBackup) {
    res.status(500)
    res.send(`Restoring backup ${restoringBackup} in progress...`)
    return
  }
  restoringBackup = fileName
  const file = `${backupsDir}/${fileName}`
  await restoreBackup({
    file
  })
  restoringBackup = null
  return 'ok'
})

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

app.listen(backupServicePort, () => {
  console.log(`backup port listening on ${backupServicePort}`)
  setTimeout(async () => {
    console.log('Service init backup:')
    await queue.add(() => doBackup())
    console.log('Service init backup completed')
  }, TEN_MINUTES)

  setInterval(async () => {
    console.log('Daily backup:')
    await queue.add(() => doBackup())
    console.log('Daily backup completed')
  }, TWENTY_FOUR_HOURS)
})
