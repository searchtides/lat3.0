const path = require('path')
const fetch = require('./fetch').fetch
const download = require('./download').evaluated_content
const { english, country } = require('./lookup')
const totalResults = require('./serp').totalResults
const _ = require('underscore')
const success = x => x.right
const lang = x => x.eng > 60
const externalAuthor = txt => /write\s+.*\s+us|guest post/i.test(txt)

const engAndWrite = (url) => {
  return download('http://' + url, path.join('./downloads', url + '.html'))
    .then(html => {
      const eng = english(html)
      const writeToUs = externalAuthor(html)
      return Promise.resolve({ right: { url, eng, writeToUs } })
    })
    .catch((error) => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { message: 'error during page dowloading', url, e } })
    })
}

const ahrefData = (x) => {
  return fetch(x.url)
    .then(h => {
      return Promise.resolve({ right: { ...x, ...h } })
    })
    .catch((error) => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { message: 'error during getting metrics', url: x.url, e } })
    })
}

const metricsPass = (drMap) => {
  const drs = _.keys(drMap).map(x => Number(x)).sort()
  if (drs.length === 0) return () => true
  const drMin = drs[0]
  const drMax = drs[drs.length - 1]
  const minTraffic = dr => drMap[drs[_.findIndex(drs, x => x >= dr)]]
  return ({ dr, tr }) => {
    if (dr < drMin || dr > drMax) return false
    return tr >= minTraffic(dr)
  }
}

const getCountry = (x) => {
  return country(x.url)
    .then(h => {
      return Promise.resolve({ right: { ...x, ...h } })
    })
    .catch((error) => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { message: 'error during country detection', url: x.url, e } })
    })
}

const serial = (funcs, logger) =>
  funcs.reduce((promise, func, i) => {
    return promise.then(result => {
      logger(JSON.stringify({ type: 'index', data: i }))
      return func()
        .then(Array.prototype.concat.bind(result))
        .catch(Array.prototype.concat.bind(result))
    })
  }
  , Promise.resolve([]))

let failed = []
const journal = {}

const batch = (task, clientsMap, logger) => {
  const urls = task.whiteList
  const clientId = task.clientId
  const clientSettings = clientsMap[clientId]
  const spam = clientSettings.spam
  const metricsPassed = metricsPass(clientSettings.drSettings)

  const detectSpam = (x) => {
    return totalResults(x, spam)
      .then(n => {
        return Promise.resolve({ right: { ...x, spam: n } })
      })
      .catch((error) => {
        const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
        return Promise.resolve({ left: { message: 'error during spam detection', url: x.url, e } })
      })
  }
  let payload = { type: 'message', data: 'detecting language and "write to us" template' }
  logger(JSON.stringify(payload))
  payload = { type: 'total', data: urls.length }
  journal.total = urls.length
  logger(JSON.stringify(payload))
  const funcs = urls.map(url => () => engAndWrite(url))
  return serial(funcs, logger).then((xs) => {
    const ys = _.filter(xs, success)
    const zs = _.reject(xs, success)
    failed = failed.concat(zs)
    return Promise.resolve(ys.map(success).filter(lang))
  })
    .then(xs => {
      journal.non_eng = urls.length - xs.length
      payload = ({ type: 'message', data: 'getting metrics' })
      logger(JSON.stringify(payload))
      payload = { type: 'total', data: xs.length }
      logger(JSON.stringify(payload))
      const funcs = xs.map(x => () => ahrefData(x))
      return serial(funcs, logger).then((xs) => {
        const ys = _.filter(xs, success)
        const zs = _.reject(xs, success)
        failed = failed.concat(zs)
        return Promise.resolve(ys.map(success).filter(metricsPassed))
      })
    })
    .then(xs => {
      journal.metrics_passed = xs.length
      payload = ({ type: 'message', data: 'detecting spam' })
      logger(JSON.stringify(payload))
      payload = { type: 'total', data: xs.length }
      logger(JSON.stringify(payload))
      const funcs = xs.map(x => () => detectSpam(x))
      return serial(funcs, logger).then((xs) => {
        const ys = _.filter(xs, success)
        const zs = _.reject(xs, success)
        failed = failed.concat(zs)
        return Promise.resolve(ys.map(success))
      })
    })
    .then(xs => {
      payload = ({ type: 'message', data: 'detecting country' })
      logger(JSON.stringify(payload))
      payload = { type: 'total', data: xs.length }
      logger(JSON.stringify(payload))
      const funcs = xs.map(x => () => getCountry(x))
      return serial(funcs, logger).then((xs) => {
        const ys = _.filter(xs, success)
        const zs = _.reject(xs, success)
        failed = failed.concat(zs)
        return Promise.resolve(ys.map(success))
      })
    })
    .then(xs => {
      journal.failed = failed.length
      return { success: xs, fails: failed, journal }
    })
}

exports.batch = batch
