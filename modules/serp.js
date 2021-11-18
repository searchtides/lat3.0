require('dotenv').config()
const axios = require('axios')
const fs = require('fs').promises
const ENDPOINT = 'https://www.googleapis.com/customsearch/v1'
const ENGINE_ID = '44045c57891c85f46'
const API_KEYS = process.env.API_KEYS.split(',')

const getPacificDate = () => {
  const date = new Date()
  const utcDate = new Date(date.toUTCString())
  utcDate.setHours(utcDate.getHours() - 8)
  const pt = new Date(utcDate)
  return pt.toISOString().split('T')[0]
}

/* eslint-disable */
const incCalls = (pathToRegister) => {
  return fs.readFile(pathToRegister, 'utf8')
    .then(txt => {
      let date = 0, calls = 0;
      [date, calls] = txt.split(' ')
      return fs.writeFile(pathToRegister, date + ' ' + (Number(calls) + 1))
    })
}

const getCalls = (pathToRegister) => {
  let calls, pDate
  pDate = getPacificDate()
  return fs.readFile(pathToRegister, 'utf8')
    .then(txt => {
      let date, _calls;
      [date, _calls] = txt.split(' ')
      if (date != pDate) {
        calls = 0
        return fs.writeFile(pathToRegister, pDate + ' ' + '0');
      } else {
        calls = Number(_calls)
        return Promise.resolve(calls)
      }
    })
    .catch((e) => {
      calls = 0
      return fs.writeFile(pathToRegister, pDate + ' ' + '0')
        .then(() => Promise.resolve(0))
    })
}

// :: Domain->[String]->Int
const totalResults = (site, keywords, pathToRegister) => {
  let n
  return getCalls(pathToRegister)
    .then(calls => {
      const idx = Math.floor(calls / 100)
      if (idx === API_KEYS.length) { return Promise.reject('quota') }
      const apiKey = API_KEYS[idx]
      let q = 'site:' + site
      if (keywords.length) { q += keywords.map(k=> ' "' + k + '"').join(" OR ") }
      else {return Promise.resolve({data:{queries:{request:[{}]}}})}
      q = encodeURIComponent(q)
      const params = 'key=' + apiKey + '&cx=' + ENGINE_ID + '&q=' + q + '&alt=json&fields=queries(request(totalResults))'
      const url = ENDPOINT + '?' + params
      return axios.get(url, {timeout: 5000})
    })
    .then(resp => {
      const data = resp.data.queries.request[0]
      n = data.totalResults ? data.totalResults : 0
      return incCalls(pathToRegister)
    })
    .then(() => {
      return Promise.resolve(n)
    })
}
/* eslint-enable */
const countKeywords = async function (url, keywords, pathToRegister) {
  const resMap = {}
  let res
  for (const kwd of keywords) {
    try {
      const count = await totalResults(url, [kwd], pathToRegister)
      res = { right: count }
    } catch (error) {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      res = { left: { url, error: e } }
    }
    resMap[kwd] = res
  }
  return resMap
}

exports.countKeywords = countKeywords
exports.totalResults = totalResults
exports.getCalls = getCalls
