const sourceAnalyzer = require('./sourceAnalyzer')
const metricsAnalyzer = require('./metricsAnalyzer')
const countryQualifier = require('./countryQualifier')
const spamDetector = require('./spamDetector')
const keywordsCounter = require('./keywordsCounter')
const ENLISH_THRESHOLD = 50

async function main ({ clientId, clientSettings, domains, logger }) {
  let res
  res = await sourceAnalyzer(domains, ENLISH_THRESHOLD, logger)
  res = await metricsAnalyzer(res, clientSettings.drSettings, logger)
  res = await countryQualifier(res, logger)
  res = await spamDetector(res, clientSettings.spam, logger)
  res = await keywordsCounter(res, clientSettings.keywords, logger)

  return Promise.resolve(res)
}

module.exports = main
