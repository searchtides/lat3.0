const fs = require('fs').promises;
const get_dmap = require("./get").dmap;
const login = require("./login").login;
const puppeteer = require('puppeteer'); 

async function fetch(domain) {
  let res = {};
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  var cookies;
  try {
    const cookiesString = await fs.readFile('./cookies.json');
    cookies = JSON.parse(cookiesString);
  } catch(e) {
    cookies = await login(browser);    
  }
  await page.setCookie(...cookies);
  let startUrl = 'https://ahrefs.com/site-explorer/overview/v2/subdomains/live?target=' + domain;
  await page.goto(startUrl);
  console.log(page.url())
  if (page.url() !== startUrl) {
    //session ended. Need to login again.
    cookies = await login(browser);    
    await page.setCookie(...cookies);
    await page.goto(startUrl);
  }
  await page.waitForSelector('#organicSearchTab', { visible: true, timeout: 0 });
  await page.click('#organicSearchTab');
  const dr = await page.$eval('#DomainRatingContainer > span', (element) => { return element.innerHTML })
  res['dr'] = Number(dr);
  await page.waitForSelector('#organic_traffic_val', { visible: true, timeout: 0 });
  const tr = await page.$eval('#organic_traffic_val', (element) => { return element.textContent })
  res['tr'] = Number(tr.split(' ')[0].replace(/,/g, ''));
  await page.waitForSelector('#organic_country_keywords_table', { visible: true, timeout: 0 });
  const table = await page.$eval('#organic_country_keywords_table', (element) => { return element.outerHTML })
  const d_map = await get_dmap(table);
  res['us_tr'] = d_map['United States'];
  await browser.close();
  return Promise.resolve(res);
};

exports.fetch = fetch;
