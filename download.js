const puppeteer = require('puppeteer')
const fs = require('fs').promises

exports.evaluated_content = (url, filename) => {
  let _data, _browser, _page
  return new Promise((resolve, reject) => {
    puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
      .then(browser => {
        _browser = browser
        return _browser.newPage()
      })
      .then(page => {
        _page = page
        return _page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
      })
      .then(() => {
        return _page.evaluate(() => document.querySelector('*').outerHTML)
      })
      .then(data => {
        _data = data
        return fs.writeFile(filename, data)
      })
      .then(() => _browser.close())
      .then(() => {
        resolve(_data)
      })
      .catch(e => {
        reject(e)
      })
      .finally(
        () => {
          if (_browser) _browser.close()
        })
  })
}
