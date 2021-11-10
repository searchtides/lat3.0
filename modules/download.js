const puppeteer = require('puppeteer')
const fs = require('fs').promises
const _ = require('lodash')
const { serial } = require('./utils')
const TIMEOUT = 60000

const evaluateBatch = (browser, urls, storageFolder, fn) => {
  const ps = urls.map(url => evaluate(browser, url, storageFolder, fn))
  let _res
  return Promise.all(ps)
    .then(res => {
      _res = res
      return browser.pages()
    })
    .then(pages => {
      return Promise.resolve(_res)
    })
}

const evaluate = (browser, url, storageFolder, fn = () => '') => {
  let _page, _data, t2
  const t1 = new Date().getTime()
  return browser.newPage()
    .then(page => {
      _page = page
      return _page.goto('http://' + url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
    })
    .then(() => {
      return _page.evaluate(() => document.querySelector('*').outerHTML)
    })
    .then(data => {
      _data = fn(data)
      t2 = new Date().getTime()
      if (storageFolder) {
        return fs.writeFile(storageFolder + '/' + url + '.html', data)
          .then(() => Promise.resolve({ right: { data: _data, time: t2 - t1, url } }))
      } else {
        return Promise.resolve({ right: { data: _data, time: t2 - t1, url } })
      }
    })
    .catch(error => {
      const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
      return Promise.resolve({ left: { error: e, url } })
    })
    .finally(() => _page.close())
}

const pBatches = (domains, batchSize = 100, fn, storageFolder, logger) => {
  const chunks = _.chunk(domains, batchSize)
  let _browser
  return puppeteer.launch({ headless: true, args: ['--no-sandbox', '--ignore-certificate-errors'] })
    .then(browser => {
      _browser = browser
      const funcs = chunks.map(chunk => () => evaluateBatch(browser, chunk, storageFolder, fn))
      return serial(funcs, logger)
        .then(res => {
          _browser.close()
          return Promise.resolve(_.flatten(res))
        })
    })
}

exports.pBatches = pBatches
