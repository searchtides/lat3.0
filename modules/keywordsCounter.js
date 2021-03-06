const { countKeywords } = require('./serp')
const _ = require('lodash')
const { serial, makeMap } = require('./utils')
const PHASE = 'keywordsCounter'

const keywordsCount = (domain, keywords, pathToRegister) => {
  return countKeywords(domain, keywords, pathToRegister)
    .then(h => {
      return Promise.resolve({ right: { url: domain, keywordsMap: h } })
    })
    .catch((error) => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { phase: PHASE, url: domain, error: e } })
    })
}

async function main ({ right, left }, keywords, pathToRegister, logger) {
  if (left) { // forwarding error
    return Promise.resolve({ right, left })
  }

  logger({ type: 'phase', data: { name: PHASE, type: 'singleAttempt' } })
  const { succeed, rejected, failed, blacklisted } = right
  const domains = _.keys(succeed)
  if (keywords.length !== 0 && domains.length !== 0) {
    logger({ type: 'blockSize', data: domains.length })
    const funcs = domains.map(domain => () => keywordsCount(domain, keywords, pathToRegister))
    const res = await serial(funcs, logger)
    const success = res.map(x => x.right).filter(x => x)
    const succeedMap = makeMap(success)
    _.keys(succeedMap).forEach(domain => {
      succeedMap[domain] = _.extend({}, succeedMap[domain], succeed[domain])
    })
    const fail = res.filter(x => x.left).map(x => _.extend({}, x.left, { phase: PHASE }))
    const failMap = makeMap(fail)
    const failedNext = _.extend({}, failed, failMap)
    return { right: { succeed: succeedMap, rejected, failed: failedNext, blacklisted } }
  } else {
    logger({ type: 'message', data: 'skip' })
    return { right: { succeed, rejected, failed, blacklisted } }
  }
}

module.exports = main
