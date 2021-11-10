const parse = require('node-html-parser').parse
const _ = require('lodash')

const coef = async function (html) {
  const root = parse(html)
  const paths = root.querySelectorAll('path')
  const path = paths.filter(
    (x) => x.rawAttributes.class === 'highcharts-graph'
  )[0]
  const d = path.rawAttributes.d
  const sum = (a, b) => a + b
  const ts = d.split(' ')
  const triples = _.chunk(ts, 3)
  const reverseYs = triples.map((x) => Number(x[2]))
  const chartHeight = _.max(reverseYs)
  let ys = reverseYs.map((y) => chartHeight - y)
  const zeroYs = ys.filter((y) => y === 0).length
  ys = ys.slice(zeroYs)
  let xs = triples.map((x) => Number(x[1]))
  const minX = _.min(xs)
  xs = xs.map((x) => x - minX).slice(zeroYs)
  const xsSum = xs.reduce(sum)
  const ysSum = ys.reduce(sum)
  const squareXsSum = xs.map((x) => x * x).reduce(sum)
  const prodXYSum = _.zip(xs, ys)
    .map((pair) => pair[0] * pair[1])
    .reduce(sum)
  const n = xs.length
  const det = (x1, y1, x2, y2) => x1 * y2 - x2 * y1
  const a1 = squareXsSum
  const b1 = xsSum
  const s1 = prodXYSum
  const a2 = xsSum
  const b2 = n
  const s2 = ysSum
  const detMain = det(a1, b1, a2, b2)
  const detA = det(s1, b1, s2, b2)
  const a = detMain !== 0 ? detA / detMain : undefined
  return a
}

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

exports.getDmap = dmap
exports.getCoef = coef
