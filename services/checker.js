const check = require('../modules/check')
const _ = require('lodash')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

const logRowError = (type, row, i, chunkIndex, e) => {
  console.error(JSON.stringify({
    type,
    index: i,
    chunkIndex,
    globalIndex: chunkIndex === undefined || i === undefined ? undefined : chunkIndex * 1000 + i,
    url: row && row.url,
    target_link: row && row.target_link,
    anchor: row && row.anchor,
    anchorType: row && typeof row.anchor,
    errorName: e && e.name,
    errorCode: e && e.code,
    errorMessage: e && e.message,
    stack: e && e.stack
  }))
}

const runSeq = async fns => {
  let xs = []
  for (const fn of fns) {
    const zs = await fn()
    xs = xs.concat(zs)
  }
  return xs
}

const genFns = chunks => {
  return chunks.map((chunk, j) => {
    return async () => {
      return await Promise.all(chunk.map(async (row, i) => {
        try {
          const res = await check.status(row, i)
          return { ...row, status: res }
        } catch (e) {
          logRowError('checker.row.error', row, i, j, e)
          return { ...row, status: 'UNABLE TO CRAWL' }
        }
      }))
    }
  })
}

async function checkStatus (rows) {
  let fns, status
  const chunks = _.chunk(rows, 1000)
  fns = genFns(chunks)
  const xs = await runSeq(fns)
  const p = x => x.status === 'CLOUDFLARE CAPTCHA'
  const cs = _.filter(xs, p)
  const ys = _.reject(xs, p)
  console.log('resolved links ' + ys.length)
  console.log('links with captcha ' + cs.length)
  let ncs = []
  if (cs.length) {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    fns = cs.map(row => async () => {
      try {
        status = await check.statusUnderCaptcha(browser, row)
      } catch (e) {
        logRowError('checker.captcha.error', row, undefined, undefined, e)
        status = 'UNABLE TO CRAWL'
      }
      return { ...row, status }
    })
    ncs = await runSeq(fns)
    console.log('resolved captcha links ' + ncs.length)
    await browser.close()
  }
  return ys.concat(ncs)
}

exports.checkStatus = checkStatus
