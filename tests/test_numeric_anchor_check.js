const assert = require('assert')
const check = require('../modules/check')

;(function () {
  const row = {
    target_link: 'https://example.com/',
    anchor: 123
  }
  const html = '<html><body><a href="https://example.com/">Example</a></body></html>'

  const status = check.statusFromData(row, html)

  assert.strictEqual(status, 'LIVE, BUT CORRUPTED ANCHOR')
  console.log({ status })
})()
