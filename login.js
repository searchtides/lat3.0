const fs = require('fs').promises;
const puppeteer = require('puppeteer'); 

async function login(browser) {
  const page = await browser.newPage();
  await page.goto('https://ahrefs.com/user/login');
  await page.waitForSelector('input[name=email]');
  await page.type('input[name=email]', 'yuriy@searchtides.com'); 
  await page.waitForSelector('input[name=password]');
  await page.type('input[name=password]', 's3]1TFyj573Kxguh'); 
  await page.click('button[type="submit"]')
  await page.waitForSelector('#dashboard', { visible: true, timeout: 0 });
  const cookies = await page.cookies();
  await fs.writeFile('./cookies.json', JSON.stringify(cookies, null, 2)); 
  return Promise.resolve(cookies);
};

exports.login = login;
