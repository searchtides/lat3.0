const { totalResults } = require('./serp')
const _ = require('lodash')
const { serial, makeMap } = require('./utils')

const detectSpam = (domain, spam) => {
  return totalResults(domain, spam)
    .then(n => {
      return Promise.resolve({ right: { url: domain, spamFound: n } })
    })
    .catch((error) => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { url: domain, error: e, message: 'error during spam detection' } })
    })
}

async function main ({ right, left }, spamKeywords, logger) {
  if (left) { // forwarding error
    return Promise.resolve({ right, left })
  }
  const { succeed, rejected, failed } = right
  const domains = _.keys(succeed)
  const blacklisted = right.blacklisted
  logger({ type: 'phase', data: 'spamDetector' })
  logger({ type: 'attempt', data: 1 })
  logger({ type: 'blockSize', data: domains.length })
  const funcs = domains.map(domain => () => detectSpam(domain, spamKeywords))
  const res = await serial(funcs, logger)
  const success = res.map(x => x.right).filter(x => x)
  const succeedMap = makeMap(success)
  _.keys(succeedMap).forEach(domain => {
    succeedMap[domain] = _.extend({}, succeedMap[domain], succeed[domain])
  })
  const fail = res.map(x => x.left).filter(x => x)
  const failMap = makeMap(fail)
  const failedNext = _.extend({}, failed, failMap)
  return { right: { succeed: succeedMap, rejected, failed: failedNext, blacklisted } }
}

module.exports = main
