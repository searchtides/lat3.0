const blackListFilter = require('./blackListFilter')
const sourceAnalyzer = require('./sourceAnalyzer')
const metricsAnalyzer = require('./metricsAnalyzer')
const countryQualifier = require('./countryQualifier')
const spamDetector = require('./spamDetector')
const keywordsCounter = require('./keywordsCounter')
const fs = require('fs').promises
const path = require('path')

async function main (task, englishConfidence, logger, pathToRegister) {
  let res
  const { drSettings, spam, keywords, domains, blackList } = task
  const total = domains.length
  res = blackListFilter(domains, blackList)
  res = await sourceAnalyzer(res, englishConfidence, logger)
  res = await metricsAnalyzer(res, drSettings, logger)
  await fs.writeFile(path.join(__dirname, '..', 'logs', 'afterMetrics.json'), JSON.stringify(res))
  res = await countryQualifier(res, logger)
  res = await spamDetector(res, spam, pathToRegister, logger)
  res = await keywordsCounter(res, keywords, pathToRegister, logger)
  res.total = total
  return Promise.resolve(res)
}

module.exports = main
