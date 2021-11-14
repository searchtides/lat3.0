const _ = require('lodash')
const { metricsPass, processInBatches } = require('./ahref')
const { makeMap } = require('./utils')
const BATCH_SIZE = 20
const ATTEMPTS = 5

async function main ({ right, left }, drSettings, logger) {
  if (left) { // forwarding error
    return Promise.resolve({ right, left })
  }
  let succeedTotal = []
  let failedLocal
  let counter = 1
  let domains = _.keys(right.succeed)
  const loop = async value => {
    do {
      logger({ type: 'attempt', data: counter })
      logger({ type: 'blockSize', data: domains.length })
      domains = await processInBatches(domains, BATCH_SIZE, logger)
        .then(xs => {
          const succeed = xs.filter(x => x.right).map(x => x.right)
          succeedTotal = succeedTotal.concat(succeed)

          failedLocal = xs.filter(x => x.left)
          const domains = failedLocal.map(x => x.left.url)
          return Promise.resolve(domains)
        })
      counter++
    } while (counter <= ATTEMPTS && domains.length > 0)
  }
  logger({ type: 'phase', data: 'metricsAnalyzer' })
  await loop()
  const { succeed, rejected, failed } = right
  const metricsPassed = metricsPass(drSettings)
  const fMap = makeMap(failedLocal.map(x => x.left))
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
  const res = { succeed: succeedMap, rejected: rejectedMap, failed: failedMap }
  return Promise.resolve({ right: res })
}

module.exports = main