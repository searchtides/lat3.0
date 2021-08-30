const parse = require('node-html-parser').parse

const distributionMap = {}
const dmap = async function (html) {
  const root = parse(html)
  root
    .querySelectorAll('tr')
    .slice(2)
    .forEach((row) => {
      const cols = row.querySelectorAll('td')
      const country = cols[0].querySelector('div').text.trim()
      const part = cols[3].querySelector('span').text.trim()
      const percentage = Number(part.slice(0, -1))
      distributionMap[country] = percentage
    })
  return distributionMap
}

exports.dmap = dmap
