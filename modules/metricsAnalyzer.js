require('dotenv').config()
const _ = require('lodash')
const { metricsPass, processInBatches } = require('./ahref')
const { makeMap } = require('./utils')
const BATCH_SIZE = process.env.AHREF_BATCH_SIZE
const ATTEMPTS = 5
const PHASE = 'metricsAnalyzer'

async function main ({ right, left }, drSettings, logger) {
  if (left) { // forwarding error
    return Promise.resolve({ right, left })
  }
  const { succeed, rejected, failed, blacklisted } = right
  let succeedTotal = []
  let failedLocal
  let counter = 1
  let domains = _.keys(succeed)
  const loop = async value => {
    do {
      logger({ type: 'attempt', data: counter })
      logger({ type: 'blockSize', data: domains.length })
      logger({ type: 'batchSize', data: BATCH_SIZE })
      domains = await processInBatches(domains, BATCH_SIZE, logger)
        .then(xs => {
          const succeed = xs.filter(x => x.right).map(x => x.right)
          succeedTotal = succeedTotal.concat(succeed)
          failedLocal = xs.filter(x => x.left)
          logger({ type: 'dev', data: { succeed: succeedTotal.length, failed: failedLocal.length } })
          const domains = failedLocal.map(x => x.left.url)
          return Promise.resolve(domains)
        })
      counter++
    } while (counter <= ATTEMPTS && domains.length > 0)
  }
  logger({ type: 'phase', data: { name: PHASE, type: 'multiAttempt' } })
  let res
  if (domains.length !== 0) {
    await loop()
    const metricsPassed = metricsPass(drSettings)
    const fMap = makeMap(failedLocal.map(x => _.extend({}, x.left, { phase: PHASE })))
    const failedMap = _.extend({}, failed, fMap)
    const passed = _.filter(succeedTotal, metricsPassed)
    const notPassed = _.reject(succeedTotal, metricsPassed)
    const notPassedMap = makeMap(notPassed)
    const succeedMap = makeMap(passed)
    _.keys(succeedMap).forEach(domain => {
      succeedMap[domain] = _.extend({}, succeedMap[domain], succeed[domain])
    })
    _.keys(notPassedMap).forEach(domain => {
      notPassedMap[domain] = _.extend({}, succeed[domain], notPassedMap[domain])
    })
    const rejectedMap = _.extend({}, rejected, notPassedMap)
    res = { succeed: succeedMap, rejected: rejectedMap, failed: failedMap, blacklisted }
  } else {
    logger({ type: 'message', data: 'skip' })
    res = { succeed, rejected, failed, blacklisted }
  }
  return Promise.resolve({ right: res })
}

module.exports = main
