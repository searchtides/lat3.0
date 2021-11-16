require('dotenv').config()
const extractDomain = require('extract-domain')
const fs = require('fs').promises
const util = require('util')
const parse = util.promisify(require('csv-parse'))
const path = require('path')
const _ = require('underscore')
const { v4: uuidv4 } = require('uuid')
const clientsMapPath = path.join(__dirname, '../db/clients_map.json')

const prettyView = xs => {
  return xs.map(h => {
    if (h.angle) h.angle = h.angle.toFixed(1)
    if (h.coef) h.coef = h.coef.toFixed(2)
    if (h.english) h.english = h.english.toFixed(0)
    return h
  })
}

// ::SuccessMap->[SuccessReportRow]
const translateSucceedToVh = h => {
  return _.keys(h).map(domain => {
    const kwMap = h[domain].keywordsMap
    const keywords = _.keys(kwMap).map(k => [k, kwMap[k].right].join(': ')).join('; ')
    const row = _.extend({}, { domain, keywords }, _.omit(h[domain], 'keywordsMap'))
    return row
  })
}

const rearrangeResults = (h, angle) => {
  const containLeft = kwMap => {
    const xs = _.keys(kwMap).map(k => kwMap[k].left)
    return _.some(xs, x => x)
  }
  const res = {}
  if (h.right) {
    const succeed = {}
    const rejected = {}
    const failed = {}
    _.keys(h.right.succeed).forEach(domain => {
      h.right.succeed[domain].angle = (Math.atan(h.right.succeed[domain].coef) * 180) / Math.PI
      const left = containLeft(h.right.succeed[domain].keywordsMap)
      if (left) {
        failed[domain] = h.right.succeed[domain]
      } else {
        if (h.right.succeed[domain].angle >= angle) {
          succeed[domain] = h.right.succeed[domain]
        } else {
          rejected[domain] = h.right.succeed[domain]
        }
      }
    })
    res.right = _.extend({}, _.omit(h.right, 'succeed', 'failed'))
    res.right.succeed = succeed
    res.right.rejected = _.extend({}, h.right.rejected, rejected)
    res.right.failed = _.extend({}, h.right.failed, failed)
    return res
  } else {
    res.left = h.left
  }
}

function genSuccessTabs (subtype, reportId) {
  const tabs = [
    { name: 'Summary', subtype: 'summary', link: 'reports/succeed/summary/' + reportId },
    { name: 'Type I', subtype: 'typeOne', link: 'reports/succeed/typeOne/' + reportId },
    { name: 'Type II', subtype: 'typeTwo', link: 'reports/succeed/typeTwo/' + reportId },
    { name: 'Type III', subtype: 'typeThree', link: 'reports/succeed/typeThree/' + reportId }]
  const xs = tabs.map(tab => {
    if (tab.subtype === subtype) {
      return _.extend({}, tab, { className: 'selected' })
    } else return tab
  })
  return xs
}

function genRejectedTabs (subtype, reportId) {
  const tabs = [
    { name: 'Summary', subtype: 'summary', link: 'reports/rejected/summary/' + reportId },
    { name: 'Not English', subtype: 'nonEnglish', link: 'reports/rejected/nonEnglish/' + reportId },
    { name: 'Low metrics', subtype: 'lowMetrics', link: 'reports/rejected/lowMetrics/' + reportId }
  ]
  const xs = tabs.map(tab => {
    if (tab.subtype === subtype) {
      return _.extend({}, tab, { className: 'selected' })
    } else return tab
  })
  return xs
}

function distributeRejected (xs) {
  const summary = xs
  const hasMetrics = x => x.dr !== undefined
  const nonEnglish = _.reject(xs, hasMetrics)
  const lowMetrics = _.filter(xs, hasMetrics)
  return { summary, nonEnglish, lowMetrics }
}

function distributeSucceed (xs, { spamThreshold, trendAngle, usTraffic }) {
  const summary = xs
  const typeOne = xs.filter(x => x.us_tr >= usTraffic && !x.writeToUs && x.spamFound <= spamThreshold && x.angle >= trendAngle)
  const typeTwo = xs.filter(x => x.us_tr >= usTraffic && x.writeToUs)
  const typeThree = xs.filter(x => x.us_tr < usTraffic || x.angle < trendAngle || x.spamFound > spamThreshold)
  return { summary, typeOne, typeTwo, typeThree }
}

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
  report.right.blacklisted = { ...toMove, ...report.right.blacklisted }
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
      const domains = _.unique(xs.map(x => regexp.test(x[idx]) ? extractDomain(x[idx]) : x[idx]))
      const task = { ...{ clientId }, ...clientsMap[clientId], ...{ domains } }
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
exports.distributeSucceed = distributeSucceed
exports.genSuccessTabs = genSuccessTabs
exports.distributeRejected = distributeRejected
exports.genRejectedTabs = genRejectedTabs
exports.prettyView = prettyView
exports.translateSucceedToVh = translateSucceedToVh
exports.rearrangeResults = rearrangeResults
