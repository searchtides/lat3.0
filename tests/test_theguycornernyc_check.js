const assert = require('assert')
const { checkStatus } = require('../services/checker')

;(async function () {
  const rows = [{
    url: 'https://theguycornernyc.com/2025/10/23/mobile-online-blackjack-playing-anytime-anywhere/',
    target_link: 'https://example.com/',
    anchor: 'example'
  }]

  const result = await checkStatus(rows)

  assert.strictEqual(result.length, 1)
  assert.strictEqual(result[0].status, 'NOT LIVE')
  console.log(result[0])
})().catch(e => {
  console.error(e)
  process.exit(1)
})
