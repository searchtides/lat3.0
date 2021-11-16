const _ = require('lodash')
const keys = x => Object.keys(x)

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
exports.keys = keys
