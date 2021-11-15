const blackListFilter = require('./blackListFilter')
const sourceAnalyzer = require('./sourceAnalyzer')
const metricsAnalyzer = require('./metricsAnalyzer')
const countryQualifier = require('./countryQualifier')
const spamDetector = require('./spamDetector')
const keywordsCounter = require('./keywordsCounter')
const ENLISH_THRESHOLD = 50

async function main (task, logger) {
  let res
  const { drSettings, spam, keywords, domains, blackList } = task
  res = blackListFilter(domains, blackList)
  res = await sourceAnalyzer(res, ENLISH_THRESHOLD, logger)
  res = await metricsAnalyzer(res, drSettings, logger)
  res = await countryQualifier(res, logger)
  res = await spamDetector(res, spam, logger)
  res = await keywordsCounter(res, keywords, logger)

  return Promise.resolve(res)
}

module.exports = main
