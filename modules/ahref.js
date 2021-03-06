const TRIES_FOR_ROWS = 30
const fs = require('fs').promises
const path = require('path')
const puppeteer = require('puppeteer')
const _ = require('lodash')
const { serial } = require('./utils')
const queryUrl = 'https://app.ahrefs.com/site-explorer/overview/v2/exact/live?target='
const backlinkUrl = 'https://app.ahrefs.com/v2-site-explorer/backlinks/exact'
const TIMEOUT = 60000
const { toNum, getDmap, getCoef } = require('./get')
const cookiesFilename = path.join(__dirname, '../operational/cookies.json')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ::DrMap->({Dr, Tr} -> Bool)
const metricsPass = (drMap) => {
  const drs = _.keys(drMap).map(x => Number(x)).sort()
  if (drs.length === 0) return () => true
  if (drs.length === 1) {
    return ({ dr, tr }) => {
      if (dr < drs[0]) return false
      return tr >= drMap[drs[0]]
    }
  } else {
    const drMin = drs[0]
    const drMax = drs[drs.length - 1]
    const minTraffic = dr => drMap[drs[_.findIndex(drs, x => x >= dr)]]
    return ({ dr, tr }) => {
      if (dr < drMin || dr > drMax) return false
      return tr >= minTraffic(dr)
    }
  }
}

async function login (browser, logger) {
  const page = await browser.newPage()
  await page.goto('https://app.ahrefs.com/user/login')
  await page.waitForSelector('input[name=email]')
  await page.type('input[name=email]', 'yuriy@searchtides.com')
  await page.waitForSelector('input[name=password]')
  await page.type('input[name=password]', 's3]1TFyj573Kxguh')
  await page.click('button[type="submit"]')
  logger({ type: 'message', data: 'waiting fo dashboard' })
  await page.waitForSelector('#dashboard', { visible: true, timeout: 0 })
  logger({ type: 'message', data: 'dashboard appeared' })
  const cookies = await page.cookies()
  await fs.writeFile(cookiesFilename, JSON.stringify(cookies, null, 2))
  logger({ type: 'message', data: 'cookies saved' })
  return Promise.resolve(cookies)
};

async function getCookies (browser, logger) {
  let cookies, found
  const dashboardUrl = 'https://app.ahrefs.com/dashboard'
  try {
    const cookiesString = await fs.readFile(cookiesFilename, 'utf8')
    cookies = JSON.parse(cookiesString)
    found = true
  } catch (e) {
    found = false
  }
  if (found) { // check if cookies out of date
    logger({ type: 'message', data: 'cookies found' })
    const page = await browser.newPage()
    await page.setCookie(...cookies)
    await page.goto(dashboardUrl, { waitUntil: 'load', timeout: 0 })
    if (page.url() !== dashboardUrl) {
      logger({ type: 'message', data: 'cookies outdated. Loggin in' })
      cookies = await login(browser, logger)
      return cookies
    }
    page.close()
    return Promise.resolve(cookies)
  } else {
    logger({ type: 'message', data: 'cookies not found. Loggin in' })
    cookies = await login(browser, logger)
    return cookies
  }
}

async function getMetrics (browser, cookies, domain, logger) {
  const res = {}
  const track = []
  const page = await browser.newPage()
  await page.setCookie(...cookies)
  try {
    await page.goto(queryUrl + domain, { waitUntil: 'load', timeout: TIMEOUT })
    await page.waitForSelector('#organicSearchTab', { visible: false, timeout: TIMEOUT })
    track.push(domain + 'organic search tab appeared')
    await page.click('#organicSearchTab')
    track.push(domain + 'organic search tab clicked')
    await page.waitForSelector('#DomainRatingContainer', { visible: false, timeout: TIMEOUT })
    track.push(domain + ' dr container appeared')
    await page.waitForSelector('#DomainRatingContainer > span', { visible: false, timeout: TIMEOUT })
    const dr = await page.$eval('#DomainRatingContainer > span', (element) => { return element.innerHTML })
    res.dr = Number(dr)
    await page.waitForSelector('#organic_traffic_val', { visible: false, timeout: TIMEOUT })
    track.push(domain + ' organic traffic  appeared')
    const tr = await page.$eval('#organic_traffic_val', (element) => { return element.textContent })
    const tr1Num = Number(tr.split(' ')[0].replace(/,/g, ''))
    await page.waitForSelector('#numberOfOrganicTraffic', { visible: true, timeout: TIMEOUT })
    const tr2 = await page.$eval('#numberOfOrganicTraffic', (element) => { return element.textContent })
    const tr2Num = toNum(tr2)
    res.tr = tr1Num > tr2Num ? tr1Num : tr2Num

    await page.waitForSelector('#organic_country_keywords_table', { visible: false, timeout: TIMEOUT })
    const table = await page.$eval('#organic_country_keywords_table', (element) => { return element.outerHTML })
    const dMap = await getDmap(table)
    res.us_tr = dMap['United States']
    await page.waitForSelector('#organic_data_chart_year1', { visible: false, timeout: TIMEOUT })
    track.push(domain + ' organic data chart  appeared')
    await page.click('#organic_data_chart_year1')
    track.push(domain + ' organic data chart clicked')
    await page.waitForFunction('document.getElementById("organic_data_chart_year1").className == "clickable chart-btn-selected"')
    const chart = await page.$eval('#organic_chart_traffic', (element) => { return element.outerHTML })
    res.coef = await getCoef(chart)
    await page.close()
    res.url = domain
    logger({ type: 'tick', data: 1 })
    return Promise.resolve({ right: res })
  } catch (error) {
    const e = JSON.stringify(error, Object.getOwnPropertyNames(error))
    await page.close()
    logger({ type: 'tick', data: 1 })
    return Promise.resolve({ left: { error: e, url: domain } })
  }
}

async function getBatchMetrics (browser, cookies, domains, logger) {
  logger({ type: 'chunkSize', data: domains.length })
  const ps = domains.map(domain => getMetrics(browser, cookies, domain, logger))
  const results = await Promise.all(ps)
  logger({ type: 'results', data: results.length })
  return Promise.resolve(results)
}

const processInBatches = (domains, batchSize = 20, logger) => {
  const chunks = _.chunk(domains, batchSize)
  let _browser
  return puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    .then(browser => {
      _browser = browser
      return getCookies(browser, logger)
    })
    .then(cookies => {
      const funcs = chunks.map(chunk => () => getBatchMetrics(_browser, cookies, chunk, logger))
      return serial(funcs, logger)
    })
    .then(res => {
      _browser.close()
      return Promise.resolve(_.flatten(res))
    })
}

async function downloadBLReport (page, domain, downloadPath, logger) {
  const normalizedDomain = encodeURIComponent(domain.replace(/https?:\/\//i, ''))
  await page.goto(queryUrl + normalizedDomain, { waitUntil: 'load', timeout: TIMEOUT })
  let urlRating
  await page.waitForSelector('#UrlRatingContainer', { visible: false, timeout: TIMEOUT })
  try {
    urlRating = await page.$eval('#UrlRatingContainer > span', (element) => { return element.innerHTML })
  } catch (e) {
    urlRating = 101
  }
  await page.waitForSelector('#DomainRatingContainer > span', { visible: false, timeout: TIMEOUT })
  const domainRating = await page.$eval('#DomainRatingContainer > span', (element) => { return element.innerHTML })
  const url = backlinkUrl + '?target=' + normalizedDomain
  await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT })
  await page.waitForXPath("//div[contains(text(), 'group of links') or contains(text(), 'groups of links')]")
  const numberOfLinksLabel = (await page.$x("//div[contains(text(), 'group of links') or contains(text(), 'groups of links')]"))[0]
  const nValue = await numberOfLinksLabel.evaluate(el => el.textContent)
  const reportSize = Number(nValue.replace(/\D+/g, ''))
  await page.waitForXPath("//button[contains(., 'Export')]")
  const [button] = await page.$x("//button[contains(., 'Export')]")
  await button.click()
  await page.waitForSelector('div.ReactModalPortal', { visible: true, timeout: TIMEOUT })
  await page.waitForXPath("//label[contains(., 'All')]")
  let rows; let value; let label; let tries = 0
  do {
    tries++
    label = (await page.$x("//label[contains(., 'All')]"))[0]
    value = await label.evaluate(el => el.textContent)
    rows = Number(value.replace(/\D+/g, ''))
    if (rows === 0) { await delay(1000) }
    if (tries > TRIES_FOR_ROWS) { logger({ type: 'domain', data: domain }) }
  } while (rows !== reportSize && tries <= TRIES_FOR_ROWS)
  if (rows !== reportSize && tries === TRIES_FOR_ROWS) {
    return Promise.resolve({ left: true })
  }
  await label.click()
  const [, second] = await page.$x("//button[contains(., 'Export')]")
  await page._client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath })
  const filesBefore = await fs.readdir(downloadPath)
  await second.click()
  await page.waitForResponse(response => response.status() === 200)
  let attempt = 10
  let diff = 0
  let allRows = false
  let filename
  do {
    await delay(1000)
    const filesAfter = await fs.readdir(downloadPath)
    diff = _.difference(filesAfter, filesBefore)
    //logger({ type: 'attempt', data: attempt })
    if (diff.length > 0) {
      filename = diff[0]
      if (filename === undefined) console.log(domain)
      const fullname = path.join(downloadPath, filename)
      const txt = await fs.readFile(fullname, 'utf16le')
      const lines = txt.split('\n')
      allRows = (lines - 2) === rows
    }
    attempt--
    const proceed = (diff.length === 0 && attempt > 0 && !allRows)
    if (!proceed) break
  } while (true)

  if (attempt) {
    const bundle = { filename, urlRating, domainRating }
    if (filename === undefined) console.log(domain)
    return Promise.resolve({ right: bundle })
  } else {
    return Promise.resolve({ left: true })
  }
}

async function getBacklinksReport (domains, downloadPath, logger) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const cookies = await getCookies(browser, logger)
  const page = await browser.newPage()
  await page.setCookie(...cookies)
  const funcs = domains.map(domain => () => downloadBLReport(page, domain, downloadPath, logger))
  const xs = await serial(funcs, logger)
  await browser.close()
  return Promise.resolve(_.flatten(xs))
}

exports.processInBatches = processInBatches
exports.metricsPass = metricsPass
exports.getBacklinksReport = getBacklinksReport
