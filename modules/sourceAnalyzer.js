const ATTEMPTS = 5
const BATCH_SIZE = 50
const _ = require('lodash')
const download = require('./download')
const path = require('path')
const fs = require('fs')
const { langDetector, makeMap } = require('./utils')
const externalAuthor = txt => /write for us|guest post/i.test(txt)
const from = 3
const to = 7
const filename = path.join(__dirname, '/../source/corpse' + from + '-' + to + '.json')
const corpse = JSON.parse(fs.readFileSync(filename, {
  encoding: 'utf8',
  flag: 'r'
}))
const english = langDetector(corpse, from, to)
const firstStep = html => { return { english: english(html), writeForUs: externalAuthor(html) } }

async function main ({ right, left }, threshold = 50, logger) {
  let counter = 1
  let succeedTotal = []
  let failedLocal
  let domains = _.keys(right.succeed)
  const blacklisted = right.blacklisted
  const loop = async value => {
    do {
      logger({ type: 'attempt', data: counter })
      logger({ type: 'blockSize', data: domains.length })
      domains = await download.pBatches(domains, BATCH_SIZE, firstStep, null, logger)
        .then(xs => {
          const succeed = xs.filter(x => x.right).map(x => x.right)
          const ys = succeed.map(x => {
            return { url: x.url, english: x.data.english, writeToUs: x.data.writeForUs }
          })
          succeedTotal = succeedTotal.concat(ys)

          failedLocal = xs.filter(x => x.left)
          const domains = failedLocal.map(x => x.left.url)
          return Promise.resolve(domains)
        })
      counter++
    } while (counter <= ATTEMPTS && domains.length > 0)
  }
  logger({ type: 'phase', data: 'sourceAnalyzer' })
  await loop()
  const p = x => x.english > threshold
  const valid = _.filter(succeedTotal, p)
  const invalid = _.reject(succeedTotal, p)
  const succeed = makeMap(valid)
  const rejected = makeMap(invalid)
  const failed = makeMap(failedLocal.map(x => x.left))
  return Promise.resolve({ right: { succeed, rejected, failed, blacklisted } })
}
module.exports = main
