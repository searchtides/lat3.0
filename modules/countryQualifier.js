const _ = require('lodash')
const { exec } = require('child_process')
const axios = require('axios')
const { serial, makeMap } = require('./utils')
const PHASE = 'countryQualifier'

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

const country = (domain) => {
  return new Promise((resolve, reject) => {
    getIp(domain)
      .then((ip) => {
        axios.get('http://www.iplocate.io/api/lookup/' + ip, { timeout: 5000 })
          .then((x) => {
            resolve(x.data.country)
          })
          .catch(e => reject(e))
      })
  })
}

const getCountry = (domain) => {
  return country(domain)
    .then(country => {
      return Promise.resolve({ right: { url: domain, country } })
    })
    .catch((error) => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { phase: PHASE, url: domain, error: e } })
    })
}

async function main ({ right, left }, logger) {
  if (left) { // forwarding error
    return Promise.resolve({ right, left })
  }
  const { succeed, rejected, failed } = right
  const domains = _.keys(succeed)
  const blacklisted = right.blacklisted
  logger({ type: 'phase', data: { name: PHASE, type: 'singleAttempt' } })
  logger({ type: 'blockSize', data: domains.length })
  const funcs = domains.map(x => () => getCountry(x))
  const res = await serial(funcs, logger)
  const success = res.map(x => x.right).filter(x => x)
  const succeedMap = makeMap(success)
  _.keys(succeedMap).forEach(domain => {
    succeedMap[domain] = _.extend({}, succeedMap[domain], succeed[domain])
  })

  const fail = res.filter(x => x.left).map(x => _.extend({}, x.left, { phase: PHASE }))
  const failMap = makeMap(fail)
  const failedNext = _.extend({}, failed, failMap)
  return { right: { succeed: succeedMap, rejected, failed: failedNext, blacklisted } }
}

module.exports = main
