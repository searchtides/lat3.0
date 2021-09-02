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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, './views/index.html'))
})

app.post('/load_file', (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.')
  }
  // The name of the input field (i.e. "sampleFile") is used to retrieve the uploaded file
  const sampleFile = req.files.myfile
  uploadPath = path.join(__dirname, '/uploads/', sampleFile.name)
  // Use the mv() method to place the file somewhere on your server
  sampleFile.mv(uploadPath, function (err) {
    if (err) return res.status(500).send(err)
    res.sendFile(path.join(__dirname, './views//progress.html'))
  })
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
