const { exec } = require('child_process')
const axios = require('axios')
const parse = require('node-html-parser').parse
const fs = require('fs')

const getIp = (domain) => {
  return new Promise((resolve, reject) => {
    exec('dig +short ' + domain, (error, stdout, stderr) => {
      if (error) { reject(error) }
      if (stderr) { reject(stderr) }
      const lines = stdout.split('\n')
      resolve(lines[lines.length - 2])
    })
  })
}

exports.country = (domain) => {
  return new Promise((resolve, reject) => {
    getIp(domain)
      .then((ip) => {
        axios.get('http://www.iplocate.io/api/lookup/' + ip)
          .then((x) => {
            resolve({ country: x.data.country })
          })
          .catch(e => reject(e))
      })
  })
}

exports.english = (html) => {
  const from = 3; const to = 7
  const corpse = JSON.parse(fs.readFileSync('./source/corpse' + from + '-' + to + '.json', { encoding: 'utf8', flag: 'r' }))

  const scriptReg = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi
  const styleReg = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi
  const imageReg = /<img.*?\/>/gi
  const stripped = html.replace(scriptReg, '').replace(styleReg, '').replace(imageReg, '')
  const root = parse(stripped)
  const divs = root.querySelectorAll('div')
  const lines = divs.map(div => { return (div.text.trim()) }).filter(x => x !== '')
  const text = lines.join(' ')
  fs.writeFileSync('./temp/extracted.txt', text)
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
