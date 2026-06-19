const check = require('../modules/check')
const _ = require('lodash')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())
const configuredCaptchaConcurrency = parseInt(process.env.CAPTCHA_CONCURRENCY || '5')
const CAPTCHA_CONCURRENCY = Number.isNaN(configuredCaptchaConcurrency) ? 5 : Math.max(configuredCaptchaConcurrency, 1)
const configuredCaptchaRowTimeout = parseInt(process.env.CAPTCHA_ROW_TIMEOUT || '90000')
const CAPTCHA_ROW_TIMEOUT = Number.isNaN(configuredCaptchaRowTimeout) ? 90000 : Math.max(configuredCaptchaRowTimeout, 1)

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

const emitProgress = (onProgress, event) => {
  if (onProgress) onProgress(event)
}

const withTimeout = async (promise, timeout, message) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(message)
          error.code = 'ETIMEDOUT'
          reject(error)
        }, timeout)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const genFns = (chunks, onProgress) => {
  return chunks.map((chunk, j) => {
    return async () => {
      return await Promise.all(chunk.map(async (row, i) => {
        try {
          const res = await check.status(row, i)
          emitProgress(onProgress, { stage: 'checking', checked: 1, status: res })
          return { ...row, status: res }
        } catch (e) {
          logRowError('checker.row.error', row, i, j, e)
          emitProgress(onProgress, { stage: 'checking', checked: 1, status: 'UNABLE TO CRAWL' })
          return { ...row, status: 'UNABLE TO CRAWL' }
        }
      }))
    }
  })
}

async function checkStatus (rows, onProgress) {
  let fns
  const chunks = _.chunk(rows, 1000)
  emitProgress(onProgress, { stage: 'checking', total: rows.length })
  fns = genFns(chunks, onProgress)
  const xs = await runSeq(fns)
  const p = x => x.status === 'CLOUDFLARE CAPTCHA'
  const cs = _.filter(xs, p)
  const ys = _.reject(xs, p)
  console.log('resolved links ' + ys.length)
  console.log('links with captcha ' + cs.length)
  emitProgress(onProgress, { stage: 'captcha', captchaTotal: cs.length })
  let ncs = []
  if (cs.length) {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    try {
      fns = _.chunk(cs, CAPTCHA_CONCURRENCY).map((chunk, j) => async () => {
        return await Promise.all(chunk.map(async (row, i) => {
          let status
          try {
            status = await withTimeout(
              check.statusUnderCaptcha(browser, row),
              CAPTCHA_ROW_TIMEOUT,
              'captcha row timeout'
            )
          } catch (e) {
            logRowError('checker.captcha.error', row, i, j, e)
            status = 'UNABLE TO CRAWL'
          }
          emitProgress(onProgress, { stage: 'captcha', captchaChecked: 1, status })
          return { ...row, status }
        }))
      })
      ncs = await runSeq(fns)
      console.log('resolved captcha links ' + ncs.length)
    } finally {
      await withTimeout(browser.close(), 10000, 'captcha browser close timeout')
        .catch(e => logRowError('checker.captcha.browser.close.error', {}, undefined, undefined, e))
    }
  }
  emitProgress(onProgress, { stage: 'finished', total: rows.length })
  return ys.concat(ncs)
}

exports.checkStatus = checkStatus
