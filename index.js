const util = require('util')
const path = require('path')
const fs = require('fs')
const express = require('express')
const fileUpload = require('express-fileupload')
const app = express()
const port = 3000
const WebSocketServer = require('ws').WebSocketServer
const parse = util.promisify(require('csv-parse'))
const _ = require('underscore')
const extractDomain = require('extract-domain')
const fetch = require('./fetch').fetch
const getCountry = require('./lookup').country
const download = require('./download').evaluated_content
const english = require('./lookup').english
const totalResults = require('./serp').totalResults
const { v4: uuidv4 } = require('uuid')
const clientsMapPath = 'db/clients_map.json'

const externalAuthor = txt => /write\s+.*\s+us|guest post/i.test(txt)
const serial = (funcs, ws) =>
  funcs.reduce((promise, func, i) => {
    return promise.then(result => {
      ws.send(JSON.stringify({ type: 'index', data: i }))
      return func()
        .then(Array.prototype.concat.bind(result))
        .catch(Array.prototype.concat.bind(result))
    }
    )
  }
  , Promise.resolve([]))

const mock = (url) => {
  let _x, _y, eng, writeToUs, redFlags
  return getCountry(url)
    .then(x => {
      _x = x
      return download('http://' + url, path.join('./downloads', url + '.html'))
    })
    .then(html => {
      eng = { eng: english(html) }
      writeToUs = externalAuthor(html)
      return fetch(url)
    })
    .then(y => {
      _y = y
      return totalResults(url, 'viagra')
        .then(n => Promise.resolve(n))
        .catch(e => Promise.resolve(e))
    })
    .then(z => {
      redFlags = { writeToUs, spam: z }
      const res = { ..._x, ..._y, ...eng, ...redFlags }
      return Promise.resolve(res)
    })
}

const wss = new WebSocketServer({ port: 8080 })

let _ws, uploadPath
const js = (x) => JSON.stringify(x)

wss.on('connection', (ws) => {
  _ws = ws
  ws.on('message', (buffer) => {
    const message = buffer.toString()
    ws.send(js({ type: 'message', data: message }))
  })
  const text = fs.readFileSync(uploadPath, { encoding: 'utf8', flag: 'r' })
  parse(text).then(xs => {
    const headers = xs.shift().map(x => x.toLowerCase())
    const idx = headers.indexOf('url')
    if (idx > -1) {
      const urls = _.unique(xs.map(x => extractDomain(x[idx])))
      _ws.send(js({ type: 'total', data: urls.length }))
      const funcs = urls.map(url => () => mock(url))
      serial(funcs, ws).then((result) => {
        ws.send(js({ type: 'finish', data: _.zip(urls, result) }))
      })
    } else {
      // TODO show error message
    }
  })
})

app.use(fileUpload())
app.set('view engine', 'pug')
app.set('views', './views')

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, './views/index.html'))
})

app.get('/process', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/progress.html'))
})

app.get('/settings_updated', (req, res) => {
  res.render('settings_updated')
})

const trim = x => x.trim()
app.post('/updating_settings', (req, res) => {
  let { clientId, spam, keywords, drSettings } = req.body
  spam = spam.replace(/[\n|\r|]/g, ',').split(',').map(trim).filter(x => x)
  keywords = keywords.replace(/[\n|\r|,\s+]/g, ',').split(',').map(trim).filter(x => x)
  drSettings = _.object(drSettings.split('\n').map(x => x.split('=').map(trim)))
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  const { blackList, clientName } = clientsMap[clientId]
  clientsMap[clientId] = { clientName, spam, keywords, drSettings, blackList }
  fs.writeFileSync(clientsMapPath, JSON.stringify(clientsMap))
  res.redirect('/settings_updated')
})

app.get('/update_settings', (req, res) => {
  res.render('update_settings')
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
      res.redirect('/start')
    } else {
      clientsMap = JSON.parse(data)
      const names = Object.keys(clientsMap).map(id => clientsMap[id].clientName)
      if (names.indexOf(clientName) > -1) {
        // client with such name already exists
        res.redirect('/client_exists')
      } else {
        clientsMap[id] = emptyRecord
        fs.writeFileSync(clientsMapPath, JSON.stringify(clientsMap))
        res.redirect('/start')
      }
    }
  })
})

app.get('/add_client', (req, res) => {
  res.render('add_client')
})

app.get('/start', (req, res) => {
  fs.readFile(clientsMapPath, 'utf8', (err, data) => {
    if (err) {
      res.send('No clients found. You should add at least one')
    } else {
      const clientsMap = JSON.parse(data)
      const opts = Object.keys(clientsMap).map(id => { return { id, name: clientsMap[id].clientName } })
      res.render('client_selection', { xs: opts })
    }
  })
})

app.post('/second_step', (req, res) => {
  const clientId = req.body.clientId
  const clientsMap = JSON.parse(fs.readFileSync(clientsMapPath, 'utf8'))
  const opts = { ...{ clientId }, ...clientsMap[clientId] }
  if (req.body.action === 'upload') {
    res.render('load_form', opts)
  }
  if (req.body.action === 'update') {
    opts.spam = opts.spam.join('\n')
    opts.keywords = opts.keywords.join('\n')
    opts.drSettings = _.pairs(opts.drSettings).map(pair => pair[0] + '=' + pair[1]).join('\n')
    res.render('update_settings', opts)
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
        const urls = _.unique(xs.map(x => extractDomain(x[idx])))
        const blackList = clientsMap[clientId].blackList
        const blackMap = _.object(blackList, blackList)
        const whiteList = urls.filter(url => blackMap[url] === undefined)
        const task = { ...{ clientId }, ...clientsMap[clientId], ...whiteList }
        fs.writeFileSync('db/task.json', JSON.stringify(task))
        res.redirect('/process')
      } else {
        // TODO show error message
      }
    })
  })
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
