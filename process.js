const path = require('path')
const fetch = require('./fetch').fetch
const download = require('./download').evaluated_content
const { english, country } = require('./lookup')
const totalResults = require('./serp').totalResults
const _ = require('underscore')
const success = x => x.right
const lang = x => x.eng > 60
const log = x => console.log(x)
const externalAuthor = txt => /write\s+.*\s+us|guest post/i.test(txt)

const engAndWrite = (url) => {
  return download('http://' + url, path.join('./downloads', url + '.html'))
    .then(html => {
      const eng = english(html)
      const writeToUs = externalAuthor(html)
      return Promise.resolve({ right: { url, eng, writeToUs } })
    })
    .catch((e) => {
      return Promise.resolve({ left: { message: 'error during engAndWrite', url } })
    })
}

const ahrefData = (x) => {
  return fetch(x.url)
    .then(h => {
      return Promise.resolve({ right: { ...x, ...h } })
    })
    .catch((e) => {
      return Promise.resolve({ left: { message: 'error during ahrefData', url: x.url } })
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
    .catch((e) => {
      return Promise.resolve({ left: { message: 'error during country detection', url: x.url } })
    })
}

const serial = (funcs, logger) =>
  funcs.reduce((promise, func, i) => {
    return promise.then(result => {
      logger(i)
      return func()
        .then(Array.prototype.concat.bind(result))
        .catch(Array.prototype.concat.bind(result))
    })
  }
  , Promise.resolve([]))

let failed = []

const batch = (task, clientsMap) => {
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
      .catch((e) => {
        return Promise.resolve({ left: { message: 'error during spam detection' } })
      })
  }

  const funcs = urls.map(url => () => engAndWrite(url))
  return serial(funcs, log).then((xs) => {
    const ys = _.filter(xs, success)
    const zs = _.reject(xs, success)
    failed = failed.concat(zs)
    return Promise.resolve(ys.map(success).filter(lang))
  })
    .then(xs => {
      const funcs = xs.map(x => () => ahrefData(x))
      return serial(funcs, log).then((xs) => {
        const ys = _.filter(xs, success)
        const zs = _.reject(xs, success)
        failed = failed.concat(zs)
        return Promise.resolve(ys.map(success).filter(metricsPassed))
      })
    })
    .then(xs => {
      const funcs = xs.map(x => () => detectSpam(x))
      return serial(funcs, log).then((xs) => {
        const ys = _.filter(xs, success)
        const zs = _.reject(xs, success)
        failed = failed.concat(zs)
        return Promise.resolve(ys.map(success))
      })
    })
    .then(xs => {
      const funcs = xs.map(x => () => getCountry(x))
      return serial(funcs, log).then((xs) => {
        const ys = _.filter(xs, success)
        const zs = _.reject(xs, success)
        failed = failed.concat(zs)
        return Promise.resolve(ys.map(success))
      })
    })
    .then(xs => {
      return { success: xs, fails: failed }
    })
}

exports.batch = batch
