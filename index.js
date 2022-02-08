require('dotenv').config()
const axios = require('axios')
const { uploadFolder } = require('./modules/gdrive')
const { getBacklinksReport } = require('./modules/ahref')
const favicon = require('serve-favicon')
const appService = require('./services/appService')
const { keys } = require('./modules/utils')
const { rearrangeResults, translateFailedToVh, translateRejectedToVh, translateSucceedToVh, prettyView } = appService
const path = require('path')
const fs = require('fs')
const fsa = require('fs').promises
const express = require('express')
const fileUpload = require('express-fileupload')
const app = express()
const port = 3000
const WebSocketServer = require('ws').WebSocketServer
const _ = require('underscore')
const __ = require('lodash')
const clientsMapPath = 'db/clients_map.json'
const validFs = x => x.replace(/:|T/g, '-')
const bodyParser = require('body-parser')

const wss = new WebSocketServer({ port: 8080 })

let t1
const js = (x) => JSON.stringify(x)

wss.on('connection', (ws) => {
  ws.on('message', (buffer) => {
    const message = buffer.toString()
    ws.send(js({ type: 'message', data: message }))
  })
  t1 = new Date().getTime()
  const task = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  const { trendAngle, englishConfidence } = JSON.parse(fs.readFileSync('db/settings.json', 'utf8'))
  const clientId = task.clientId
  const clientName = task.clientName
  const log = []
  const logger = (x) => {
    ws.send(JSON.stringify(x))
    log.push(x)
  }
  appService.qualifier(task, englishConfidence, logger)
    .then((res) => {
      const h = rearrangeResults(res, trendAngle)
      ws.send(js({ type: 'finish', data: res }))
      const t = new Date()
      const t2 = t.getTime()
      const timestamp = t.toISOString().split('.')[0]
      const root = timestamp.replace(/:|T/g, '-')
      const filename = path.join(__dirname, 'results/' + root + '.json')
      h.right.timestamp = timestamp
      h.right.elapsedTime = Math.ceil((t2 - t1) / 1000)
      h.right.clientId = clientId
      h.right.clientName = clientName
      fs.writeFileSync(filename, JSON.stringify(h))
      if (process.env.DEV_MODE === 'on') {
        const logFilename = path.join(__dirname, 'logs', root + '.json')
        fs.writeFileSync(logFilename, JSON.stringify(log))
      }
    })
})

app.use(fileUpload())
app.set('view engine', 'pug')
app.set('views', './views')
app.use(favicon('favicon.png'))
app.use(bodyParser.json())

app.get('/', async (req, res) => {
  const clientsList = await appService.getClients()
  const quotas = await appService.getQuotasRemaining()
  if (clientsList.length) {
    res.render('home', { xs: clientsList, quotas })
  } else {
    res.redirect('/add_client')
  }
})

app.post('/bcc', async (req, res) => {
  let domains = req.body.urls.map(d => d.trim().replace(/\/$/, ''))
  const callback = req.body.callback
  const folderId = process.env.UPLOAD_FOLDER_ID
  res.send('ok')
  const domainsMap = __.zipObject(domains, _.range(0, domains.length).map(i => _.extend({}, { idx: i })))
  const folder = new Date().toISOString().split('.')[0]
  const downloadPath = path.join(__dirname, 'downloads', folder)
  await fsa.mkdir(downloadPath, { recurcive: true })
  while (domains.length) {
    console.log(domains.length)
    const res = await getBacklinksReport(domains, downloadPath, console.log)
    const ps = _.zip(domains, res)
    ps.forEach(function (p) {
      domainsMap[p[0]] = _.extend({}, domainsMap[p[0]], p[1].right ? p[1].right : '')
    })
    domains = ps.filter(p => p[1].right === undefined).map(p => p[0])
  }
  await fsa.writeFile(path.join(downloadPath, 'fileMap.json'), JSON.stringify(domainsMap))
  const containerFolderId = await uploadFolder(downloadPath, folderId)
  const url = callback + '?id=' + containerFolderId
  await axios.get(url)
})

app.get('/downlog', async (req, res) => {
  const { filename } = req.query
  const fullDestName = path.join(__dirname, 'logs', filename)
  res.download(fullDestName, filename)
})

app.get('/logs', async (req, res) => {
  const xs = await appService.getLogs()
  res.render('logs', { xs })
})

app.get('/reports', async (req, res) => {
  const xs = await appService.getReports()
  res.render('reports', { xs })
})

app.get('/reports/succeed/:subtype/:reportId', async (req, res) => {
  const { subtype, reportId } = req.params
  const result = await appService.getSucceed(subtype, reportId)
  if (result.right) {
    res.render('success', result.right)
  } else res.send('page not found')
})

app.get('/reports/rejected/:subtype/:reportId', async (req, res) => {
  const { subtype, reportId } = req.params
  const result = await appService.getRejected(subtype, reportId)
  if (result.right) {
    res.render('rejected', result.right)
  } else res.send('page not found')
})

app.get('/reports/failed/:subtype/:reportId', async (req, res) => {
  const { subtype, reportId } = req.params
  const result = await appService.getFailed(subtype, reportId)
  if (result.right) {
    res.render('failed', result.right)
  } else res.send('page not found')
})

app.get('/reports/blacklisted/:reportId', async (req, res) => {
  const { reportId } = req.params
  const result = await appService.getBlacklisted(reportId)
  res.render('blacklisted', result)
})

app.get('/download', (req, res) => {
  const { type, subtype, reportId } = req.query
  const filename = validFs(reportId)
  const fullname = path.join(__dirname, 'results', filename + '.json')
  const result = JSON.parse(fs.readFileSync(fullname, 'utf8'))
  const h = result.right[type]
  const generalSettings = JSON.parse(fs.readFileSync('db/settings.json'))
  let distr, vh, fn
  switch (type) {
    case 'succeed':
      fn = _.compose(prettyView, translateSucceedToVh)
      vh = fn(h)
      distr = appService.distributeSucceed(vh, generalSettings)
      break
    case 'rejected':
      fn = _.compose(prettyView, translateRejectedToVh)
      vh = fn(h)
      distr = appService.distributeRejected(vh)
      break
    case 'failed':
      fn = _.compose(prettyView, translateFailedToVh)
      vh = fn(h)
      distr = appService.distributeFailed(vh)
      break
  }
  const xs = distr[subtype]
  if (xs.length) {
    const headers = keys(xs[0])
    let m = xs.map(x => {
      return headers.map(header => x[header]).join(',')
    })
    m = [headers.join(',')].concat(m)
    const destFilename = [type, subtype, filename].join('-') + '.csv'
    const fullDestName = path.join(__dirname, 'operational', destFilename)
    fs.writeFileSync(fullDestName, m.join('\n'))
    res.download(fullDestName, destFilename)
  } else res.end()
})

app.post('/add_to_blacklist', async (req, res) => {
  const { reportId, type, subtype } = req.body
  await appService.addToBlackList(req.body)
  res.redirect('/reports/' + type + '/' + subtype + '/' + reportId)
})

app.get('/process', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/progress.html'))
})

const trim = x => x.trim()
app.post('/update_client_settings', (req, res) => {
  let { clientId, spam, keywords, drSettings, blackList } = req.body
  spam = spam.replace(/[\n|\r|]/g, ',').split(',').map(trim).filter(x => x)
  keywords = keywords.replace(/[\n|\r|,\s+]/g, ',').split(',').map(trim).filter(x => x)
  blackList = blackList.replace(/[\n|\r|]/g, ',').split(',').map(trim).filter(x => x)
  drSettings = _.object(drSettings.split('\n').map(x => x.split('=').map(trim)))
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  const { clientName } = clientsMap[clientId]
  clientsMap[clientId] = { clientName, spam, keywords, drSettings, blackList }
  fs.writeFileSync(clientsMapPath, JSON.stringify(clientsMap))
  res.render('client_settings_updated', { clientName })
})

app.get('/get_settings', (req, res) => {
  let h
  fsa.readFile('db/settings.json', 'utf8')
    .then(txt => {
      h = JSON.parse(txt)
      return Promise.resolve(h)
    })
    .catch(e => {
      h = { spamThreshold: 0, trendAngle: 5, usTraffic: 80, englishConfidence: 50 }
      fs.writeFileSync('db/settings.json', JSON.stringify(h))
      return Promise.resolve(h)
    })
    .then(h => {
      res.render('settings_form', h)
    })
})

app.post('/update_settings', (req, res) => {
  const h = req.body
  fs.writeFileSync('db/settings.json', JSON.stringify(h))
  res.render('settings_updated')
})

app.get('/client_exists', (req, res) => {
  res.render('client_exists')
})

app.post('/client_added', async (req, res) => {
  const addingAttempt = await appService.addClient(req.body.clientName)
  if (addingAttempt) { res.redirect('/') } else { res.redirect('/client_exists') }
})

app.get('/add_client', (req, res) => {
  res.render('add_client')
})

app.get('/load_attempt', async (req, res) => {
  const opts = await appService.getClientFromTask()
  res.render('load_form', opts)
})

app.get('/get_clients_settings', (req, res) => {
  const { clientId } = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  const opts = { ...{ clientId }, ...clientsMap[clientId] }
  opts.spam = opts.spam.join('\n')
  opts.keywords = opts.keywords.join('\n')
  opts.blackList = opts.blackList.join('\n')
  opts.drSettings = _.pairs(opts.drSettings).map(pair => pair[0] + '=' + pair[1]).join('\n')
  res.render('client_settings_form', opts)
})

app.post('/second_step', async (req, res) => {
  await appService.createTask(req.body.clientId)
  if (req.body.action === 'upload') {
    res.redirect('load_attempt')
  }
  if (req.body.action === 'update') {
    res.redirect('get_clients_settings')
  }
})

app.post('/load_file', async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.')
  }
  const { err } = await appService.updateTask(req.body.clientId, req.files.myfile)
  if (err) {
    res.render('loading_error', { err })
  } else {
    res.redirect('/process')
  }
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
