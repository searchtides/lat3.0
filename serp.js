const axios = require('axios')
const fs = require('fs').promises
const ENDPOINT = 'https://www.googleapis.com/customsearch/v1'
const ENGINE_ID = '44045c57891c85f46'
const API_KEYS = ['AIzaSyAuhNHa0sb4xPmAdsKTvzTDUjBDuYBfcM4']

const getPacificDate = () => {
  const date = new Date()
  const utcDate = new Date(date.toUTCString())
  utcDate.setHours(utcDate.getHours() - 8)
  const pt = new Date(utcDate)
  return pt.toISOString().split('T')[0]
}

/* eslint-disable */
const incCalls = () => {
  return fs.readFile('db/requests.json', 'utf8')
    .then(txt => {
      let date = 0, calls = 0;
      [date, calls] = txt.split(' ')
      return fs.writeFile('db/requests.json', date + ' ' + (Number(calls) + 1))
    })
}

const getCalls = () => {
  let calls, pDate
  pDate = getPacificDate()
  return fs.readFile('db/requests.json', 'utf8')
    .then(txt => {
      let date, _calls;
      [date, _calls] = txt.split(' ')
      if (date != pDate) {
        calls = 0
        return fs.writeFile('db/requests.json', pDate + ' ' + '0');
      } else {
        calls = Number(_calls)
        return Promise.resolve(calls)
      }
    })
    .catch((e) => {
      calls = 0
      return fs.writeFile('db/requests.json', pDate + ' ' + '0')
        .then(() => Promise.resolve(0))
    })
}

const totalResults = (h, keywords) => {
  let n
  let site = h.url
  return getCalls()
    .then(calls => {
      const idx = Math.floor(calls / 100)
      if (idx === API_KEYS.length) { return Promise.reject('qouta') }
      const apiKey = API_KEYS[idx]
      let q = 'site:' + site
      if (keywords.length) { q += keywords.map(k=> ' "' + k + '"').join(" OR ") }
      else {return Promise.resolve({data:{queries:{request:[{}]}}})}
      q = encodeURIComponent(q)
      const params = 'key=' + apiKey + '&cx=' + ENGINE_ID + '&q=' + q + '&alt=json&fields=queries(request(totalResults))'
      const url = ENDPOINT + '?' + params
      return axios.get(url)
    })
    .then(resp => {
      const data = resp.data.queries.request[0]
      n = data.totalResults ? data.totalResults : 0
      return incCalls()
    })
    .then(() => {
      return Promise.resolve(n)
    })
}
/* eslint-enable */
exports.totalResults = totalResults
