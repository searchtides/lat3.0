require('dotenv').config()
const extractDomain = require('extract-domain')
const fs = require('fs').promises
const util = require('util')
const parse = util.promisify(require('csv-parse'))
const path = require('path')
const _ = require('underscore')
const { v4: uuidv4 } = require('uuid')
const clientsMapPath = path.join(__dirname, '../db/clients_map.json')

async function addToBlackList (h) {
  const { reportId, type } = h
  const domains = _.keys(_.omit(h, 'reportId', 'type'))
  const root = reportId.replace(/:|T/g, '-')
  const reportFilename = path.join(__dirname, '../results/', root + '.json')
  const report = JSON.parse(await fs.readFile(reportFilename, 'utf8'))
  const clientId = report.right.clientId
  const clientsMap = JSON.parse(await fs.readFile(clientsMapPath, 'utf8'))
  const nextBlackList = clientsMap[clientId].blackList.concat(domains)
  clientsMap[clientId].blackList = _.unique(nextBlackList)
  await fs.writeFile(clientsMapPath, JSON.stringify(clientsMap))
  const rest = _.omit(report.right[type], domains)
  const toMove = _.pick(report.right[type], domains)
  report.right[type] = rest
  report.right.blacklisted = toMove
  await fs.writeFile(reportFilename, JSON.stringify(report))
}

async function getQuotasRemaining () {
  const apiKeysN = process.env.API_KEYS.split(',').length * 100
  const txt = await fs.readFile(path.join(__dirname, '../db/requests.json'), 'utf8')
  const requests = Number(txt.split(' ')[1])
  return { serp: apiKeysN - requests }
}

async function updateTask (clientId, sampleFile) {
  const clientsMap = JSON.parse(await fs.readFile(clientsMapPath, 'utf8'))
  const uploadPath = path.join(__dirname, '../uploads/', sampleFile.name)
  try {
    await sampleFile.mv(uploadPath)
    const text = await fs.readFile(uploadPath, { encoding: 'utf8', flag: 'r' })
    const xs = await parse(text)
    const headers = xs.shift().map(x => x.toLowerCase())
    const idx = headers.indexOf('url')
    if (idx > -1) {
      const regexp = /http|\//
      const urls = _.unique(xs.map(x => regexp.test(x[idx]) ? extractDomain(x[idx]) : x[idx]))
      const blackList = clientsMap[clientId].blackList
      const blackMap = _.object(blackList, blackList)
      const whiteList = urls.filter(url => blackMap[url] === undefined)
      const task = { ...{ clientId }, ...clientsMap[clientId], ...{ whiteList } }
      await fs.writeFile('db/task.json', JSON.stringify(task))
      return { err: null }
    }
  } catch (err) {
    return { err }
  }
}

// ::IO () -> {:clientId, :clentName}
async function getClientFromTask () {
  const { clientId } = JSON.parse(await fs.readFile('db/task.json', 'utf8'))
  const clientsMap = JSON.parse(await fs.readFile(clientsMapPath, 'utf8'))
  const clientName = clientsMap[clientId].clientName
  return { clientId, clientName }
}

async function getClients () {
  return fs.readFile(clientsMapPath, 'utf8')
    .then(data => {
      const clientsMap = JSON.parse(data)
      const opts = Object.keys(clientsMap).map(id => { return { id, name: clientsMap[id].clientName } })
      return opts
    })
    .catch(e => [])
}

async function addClient (clientName) {
  const clientsMap = {}
  const emptyRecord = { clientName, spam: [], keywords: [], blackList: [], drSettings: {} }
  const id = uuidv4()
  const success = data => {
    const clientsMap = JSON.parse(data)
    const names = Object.keys(clientsMap).map(id => clientsMap[id].clientName)
    if (names.indexOf(clientName) > -1) {
      return Promise.resolve(false)
    } else {
      clientsMap[id] = emptyRecord
      return fs.writeFile(clientsMapPath, JSON.stringify(clientsMap))
        .then(() => Promise.resolve(true))
    }
  }
  const error = e => {
    clientsMap[id] = emptyRecord
    return fs.writeFile(clientsMapPath, JSON.stringify(clientsMap))
      .then(() => Promise.resolve(true))
  }
  return fs.readFile(clientsMapPath, 'utf8')
    .then(success, error)
}

async function createTask (clientId) {
  await fs.writeFile('db/task.json', JSON.stringify({ clientId }))
}

exports.getClients = getClients
exports.addClient = addClient
exports.createTask = createTask
exports.getClientFromTask = getClientFromTask
exports.updateTask = updateTask
exports.getQuotasRemaining = getQuotasRemaining
exports.addToBlackList = addToBlackList
