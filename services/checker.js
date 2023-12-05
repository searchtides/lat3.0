const check = require('../modules/check')
const _ = require('lodash')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

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
        const res = await check.status(row, i)
        return { ...row, status: res }
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
      } catch(e) {
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
