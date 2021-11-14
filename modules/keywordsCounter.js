const { countKeywords } = require('./serp')
const _ = require('lodash')
const { serial, makeMap } = require('./utils')

const keywordsCount = (domain, keywords) => {
  return countKeywords(domain, keywords)
    .then(h => {
      return Promise.resolve({ right: { url: domain, keywordsMap: h } })
    })
    .catch((error) => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { message: 'error during keywords counting', url: domain, e } })
    })
}

async function main ({ right, left }, keywords, logger) {
  if (left) { // forwarding error
    return Promise.resolve({ right, left })
  }

  const { succeed, rejected, failed } = right
  const domains = _.keys(succeed)
  logger({ type: 'phase', data: 'keywordsCounter' })
  logger({ type: 'attempt', data: 1 })
  logger({ type: 'blockSize', data: domains.length })
  const funcs = domains.map(domain => () => keywordsCount(domain, keywords))
  const res = await serial(funcs, logger)
  const success = res.map(x => x.right).filter(x => x)
  const succeedMap = makeMap(success)
  _.keys(succeedMap).forEach(domain => {
    succeedMap[domain] = _.extend({}, succeedMap[domain], succeed[domain])
  })
  const fail = res.map(x => x.left).filter(x => x)
  const failMap = makeMap(fail)
  const failedNext = _.extend({}, failed, failMap)
  return { right: { succeed: succeedMap, rejected, failed: failedNext } }
}

module.exports = main