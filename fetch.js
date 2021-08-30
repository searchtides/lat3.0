const fs = require('fs').promises
const getDmap = require('./get').dmap
const login = require('./login').login
const puppeteer = require('puppeteer')

const toNumbers = (s) => {
  const last = s.slice(-1)
  let k = 1
  let v = s
  if (last === 'M') { k = 1000000; v = s.slice(0, -1) }
  if (last === 'K') { k = 1000; v = s.slice(0, -1) }
  return Number(v) * k
}

async function fetch (domain) {
  const res = {}
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  let cookies
  try {
    const cookiesString = await fs.readFile('./cookies.json')
    cookies = JSON.parse(cookiesString)
  } catch (e) {
    cookies = await login(browser)
  }
  await page.setCookie(...cookies)
  const startUrl = 'https://ahrefs.com/site-explorer/overview/v2/subdomains/live?target=' + domain
  await page.goto(startUrl)
  console.log(page.url())
  if (page.url() !== startUrl) {
    // session ended. Need to login again.
    cookies = await login(browser)
    await page.setCookie(...cookies)
    await page.goto(startUrl)
  }
  await page.waitForSelector('#organicSearchTab', { visible: true, timeout: 0 })
  await page.click('#organicSearchTab')
  const dr = await page.$eval('#DomainRatingContainer > span', (element) => { return element.innerHTML })
  res.dr = Number(dr)
  await page.waitForSelector('#organic_traffic_val', { visible: true, timeout: 0 })
  await page.waitForSelector('#organic_country_keywords_table', { visible: true, timeout: 0 })
  const table = await page.$eval('#organic_country_keywords_table', (element) => { return element.outerHTML })
  const dMap = await getDmap(table)
  res.us_tr = dMap['United States']
  const trBig = await page.$eval('#numberOfOrganicTraffic > span', (element) => { return element.textContent })
  res.tr = toNumbers(trBig)
  await browser.close()
  return Promise.resolve(res)
};

exports.fetch = fetch
