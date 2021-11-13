const _ = require('lodash')
const keys = x => Object.keys(x)

// ::SuccessMap->[SuccessReportRow]
const translateSucceedToVh = h => {
  return keys(h).map(domain => {
    const kwMap = h[domain].keywordsMap
    const keywords = keys(kwMap).map(k => [k, kwMap[k].right].join(': ')).join(', ')
    const row = _.extend({}, { domain, keywords }, _.omit(h[domain], 'keywordsMap'))
    return row
  })
}

const rearrangeResults = (h, angle) => {
  const containLeft = kwMap => {
    const xs = keys(kwMap).map(k => kwMap[k].left)
    return _.some(xs, x => x)
  }
  const res = {}
  if (h.right) {
    const succeed = {}
    const rejected = {}
    const failed = {}
    keys(h.right.succeed).forEach(domain => {
      h.right.succeed[domain].angle = (Math.atan(h.right.succeed[domain].coef) * 180) / Math.PI
      const left = containLeft(h.right.succeed[domain].keywordsMap)
      if (left) {
        failed[domain] = h.right.succeed[domain]
      } else {
        if (h.right.succeed[domain].angle >= angle) {
          succeed[domain] = h.right.succeed[domain]
        } else {
          rejected[domain] = h.right.succeed[domain]
        }
      }
    })
    res.right = _.extend({}, _.omit(h.right, 'succeed', 'failed'))
    res.right.succeed = succeed
    res.right.rejected = _.extend({}, h.right.rejected, rejected)
    res.right.failed = _.extend({}, h.right.failed, failed)
    return res
  } else {
    res.left = h.left
  }
}

const serial = (funcs, logger) =>
  funcs.reduce((promise, func, i) => {
    return promise.then(result => {
      logger({ type: 'index', data: i })
      return func()
        .then(Array.prototype.concat.bind(result))
        .catch(Array.prototype.concat.bind(result))
    })
  }
  , Promise.resolve([]))

const makeMap = xs => {
  const urls = xs.map(x => x.url)
  const values = xs.map(x => _.omit(x, 'url'))
  return _.zipObject(urls, values)
}

const parse = require('node-html-parser').parse
const langDetector = (corpse, from, to) => {
  return (html) => {
    const scriptReg = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
    const styleReg = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi
    const imageReg = /<img.*?>/gi
    const stripped = html.replace(scriptReg, '').replace(styleReg, '').replace(imageReg, '')
    const root = parse(stripped)
    const divs = root.querySelectorAll('div')
    const lines = divs.map(div => {
      return (div.text.trim())
    }).filter(x => x !== '')
    const text = lines.join(' ')
    const words = text.replace('\n', ' ').replace(/[^a-zA-Z|-]+/g, ' ').replace(/\s\s+/g, ' ').toLowerCase().split(' ')
    const middleWords = words.filter(w => w.length >= from && w.length <= to)
    const freqMap = {}
    middleWords.forEach(word => {
      if (!freqMap[word]) {
        freqMap[word] = 0
      }
      freqMap[word]++
    })
    const pairs = Object.entries(freqMap)
    const sorted = pairs.sort((a, b) => {
      if (a[1] > b[1]) return -1
      if (a[1] < b[1]) return 1
      return 0
    })
    const last = 30
    const tops = sorted.slice(0, last).map(x => x[0])
    const ts = tops.map(w => corpse[w]).filter(x => x)
    const probability = 100 * ts.length / last
    return probability
  }
}
exports.langDetector = langDetector
exports.makeMap = makeMap
exports.serial = serial
exports.rearrangeResults = rearrangeResults
exports.keys = keys
exports.translateSucceedToVh = translateSucceedToVh
