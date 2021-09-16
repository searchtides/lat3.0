require('dotenv').config()
const util = require('util')
const path = require('path')
const fs = require('fs')
const fsa = require('fs').promises
const express = require('express')
const fileUpload = require('express-fileupload')
const app = express()
const port = 3000
const WebSocketServer = require('ws').WebSocketServer
const parse = util.promisify(require('csv-parse'))
const _ = require('underscore')
const extractDomain = require('extract-domain')
const { v4: uuidv4 } = require('uuid')
const processBatch = require('./process').batch
const clientsMapPath = 'db/clients_map.json'
const send = require('./mailer').send

const wss = new WebSocketServer({ port: 8080 })

let _ws, uploadPath
const js = (x) => JSON.stringify(x)

wss.on('connection', (ws) => {
  _ws = ws
  ws.on('message', (buffer) => {
    const message = buffer.toString()
    ws.send(js({ type: 'message', data: message }))
  })
  const task = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  const urls = task.whiteList
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  _ws.send(js({ type: 'total', data: urls.length }))
  processBatch(task, clientsMap, x => ws.send(x))
    .then((result) => {
      ws.send(js({ type: 'finish', data: result }))
      fs.writeFileSync('db/result.json', JSON.stringify(result))
    })
})

app.use(fileUpload())
app.set('view engine', 'pug')
app.set('views', './views')

app.get('/result_failed', (req, res) => {
  const xs = JSON.parse(fs.readFileSync('db/failed.json', 'utf8'))
  const task = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  res.render('failed', { xs, clientName: task.clientName, records: xs.length })
})

app.get('/result_type_one', (req, res) => {
  const xs = JSON.parse(fs.readFileSync('db/typeOne.json', 'utf8'))
  const task = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  res.render('type_one', { xs, clientName: task.clientName, records: xs.length })
})

app.get('/result_type_two', (req, res) => {
  const xs = JSON.parse(fs.readFileSync('db/typeTwo.json', 'utf8'))
  const task = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  res.render('type_two', { xs, clientName: task.clientName, records: xs.length })
})

app.get('/result_type_three', (req, res) => {
  const xs = JSON.parse(fs.readFileSync('db/typeThree.json', 'utf8'))
  const task = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  res.render('type_three', { xs, clientName: task.clientName, records: xs.length })
})

app.get('/download', (req, res) => {
  const root = req.query.filename
  const filename = path.join('db', root)
  const result = JSON.parse(fs.readFileSync(filename + '.json', 'utf8'))
  if (result.length === 0) res.end()
  const headers = Object.keys(result[0])
  let m = result.map(x => {
    return headers.map(header => x[header]).join(',')
  })
  m = [headers.join(',')].concat(m)
  /* eslint-disable */
  fs.writeFileSync(filename + '.csv', m.join("\n"))
  /* eslint-enable */
  res.download(filename + '.csv', root + '.csv')
})

app.post('/add_to_blacklist', (req, res) => {
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  const { clientId } = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  const result = JSON.parse(fs.readFileSync('db/result.json', 'utf8'))
  const xs = Object.keys(req.body)
  clientsMap[clientId].blackList = _.unique(clientsMap[clientId].blackList.concat(xs))
  fs.writeFileSync(clientsMapPath, JSON.stringify(clientsMap))
  const blackMap = _.object(xs, xs)
  const filtered = result.success.filter(x => blackMap[x.url] === undefined)
  result.success = filtered
  fs.writeFileSync('db/result.json', JSON.stringify(result))
  res.redirect('/results')
})

app.get('/results', (req, res) => {
  const result = JSON.parse(fs.readFileSync('db/result.json', 'utf8'))
  const success = result.success
  const summary = success
  success.forEach(x => {
    x.kwds = _.keys(x.keywords).map(kwd => kwd + ':' + (x.keywords[kwd].right ? x.keywords[kwd].right : 'error')).join(', ')
  })
  console.log(success)
  const journal = result.journal
  fs.writeFileSync('db/summary.json', JSON.stringify(summary))
  const typeOne = success.filter(x => x.us_tr >= 80 && !x.writeToUs && x.spam === 0)
  fs.writeFileSync('db/typeOne.json', JSON.stringify(typeOne))
  const typeTwo = success.filter(x => x.us_tr >= 80 && x.writeToUs)
  fs.writeFileSync('db/typeTwo.json', JSON.stringify(typeTwo))
  const typeThree = success.filter(x => x.spam > 0 || x.us_tr < 80)
  fs.writeFileSync('db/typeThree.json', JSON.stringify(typeThree))
  const failed = result.fails.map(x => x.left)
  const failedFilename = 'db/failed'
  fs.writeFileSync(failedFilename + '.json', JSON.stringify(failed))
  if (failed.length) {
    const dateSuffix = new Date().toISOString().split('.')[0]
    fs.writeFileSync(failedFilename + dateSuffix + '.json', JSON.stringify(failed))
    if (process.env.DEV_MODE === 'on') {
      send(failedFilename + dateSuffix)
        .then(x => x)
        .catch(e => e)
    }
  }
  const task = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  res.render('results', { records: success.length, success, ...task, journal })
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
      h = { spamThreshold: 0, trendAngle: 5 }
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

app.post('/client_added', (req, res) => {
  const clientName = req.body.clientName
  let clientsMap = {}
  const emptyRecord = { clientName, spam: [], keywords: [], blackList: [], drSettings: {} }
  fs.readFile(clientsMapPath, 'utf8', (err, data) => {
    const id = uuidv4()
    if (err) {
      clientsMap[id] = emptyRecord
      fs.writeFileSync(clientsMapPath, JSON.stringify(clientsMap))
      res.redirect('/')
    } else {
      clientsMap = JSON.parse(data)
      const names = Object.keys(clientsMap).map(id => clientsMap[id].clientName)
      if (names.indexOf(clientName) > -1) {
        // client with such name already exists
        res.redirect('/client_exists')
      } else {
        clientsMap[id] = emptyRecord
        fs.writeFileSync(clientsMapPath, JSON.stringify(clientsMap))
        res.redirect('/')
      }
    }
  })
})

app.get('/add_client', (req, res) => {
  res.render('add_client')
})

app.get('/', (req, res) => {
  fs.readFile(clientsMapPath, 'utf8', (err, data) => {
    if (err) {
      res.redirect('/add_client')
    } else {
      const clientsMap = JSON.parse(data)
      const opts = Object.keys(clientsMap).map(id => { return { id, name: clientsMap[id].clientName } })
      res.render('client_selection', { xs: opts })
    }
  })
})

app.get('/load_attempt', (req, res) => {
  const { clientId } = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  const opts = { ...{ clientId }, ...clientsMap[clientId] }
  res.render('load_form', opts)
})

app.get('/get_settings', (req, res) => {
  const { clientId } = JSON.parse(fs.readFileSync('db/task.json', 'utf8'))
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  const opts = { ...{ clientId }, ...clientsMap[clientId] }
  opts.spam = opts.spam.join('\n')
  opts.keywords = opts.keywords.join('\n')
  opts.blackList = opts.blackList.join('\n')
  opts.drSettings = _.pairs(opts.drSettings).map(pair => pair[0] + '=' + pair[1]).join('\n')
  res.render('client_settings_form', opts)
})

app.post('/second_step', (req, res) => {
  const clientId = req.body.clientId
  fs.writeFileSync('db/task.json', JSON.stringify({ clientId }))
  if (req.body.action === 'upload') {
    res.redirect('load_attempt')
  }
  if (req.body.action === 'update') {
    res.redirect('get_settings')
  }
})

app.post('/load_file', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.')
  }
  const clientId = req.body.clientId
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  // The name of the input field (i.e. "sampleFile") is used to retrieve the uploaded file
  const sampleFile = req.files.myfile
  uploadPath = path.join(__dirname, '/uploads/', sampleFile.name)
  // Use the mv() method to place the file somewhere on your server
  sampleFile.mv(uploadPath, function (err) {
    if (err) return res.status(500).send(err)
    const text = fs.readFileSync(uploadPath, { encoding: 'utf8', flag: 'r' })
    parse(text).then(xs => {
      const headers = xs.shift().map(x => x.toLowerCase())
      const idx = headers.indexOf('url')
      if (idx > -1) {
        const regexp = /http|\//
        const urls = _.unique(xs.map(x => regexp.test(x[idx]) ? extractDomain(x[idx]) : x[idx]))
        const blackList = clientsMap[clientId].blackList
        const blackMap = _.object(blackList, blackList)
        const whiteList = urls.filter(url => blackMap[url] === undefined)
        const task = { ...{ clientId }, ...clientsMap[clientId], ...{ whiteList } }
        fs.writeFileSync('db/task.json', JSON.stringify(task))
        res.redirect('/process')
      } else {
        res.render('loading_error')
      }
    })
  })
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
