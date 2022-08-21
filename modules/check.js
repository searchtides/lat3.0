const _ = require('lodash')
const axios = require('axios')
const TIMEOUT = 60000
const userAgent = 'Mozilla/5.0 (Linux; Android 10; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.41 Mobile Safari/537.36.'

async function statusUnderCaptcha (browser, h) {
  const page = await browser.newPage()
  let success = true
  try {
    await page.goto(h.url, { waitUntil: 'networkidle2', timeout: TIMEOUT })
  } catch (e) {
    success = false
  }
  if (success) {
    const data = await page.content()
    return statusFromData(h, data)
  }
  return 'UNABLE TO CRAWL'
}

const statusFromData = (h, data) => {
  let status
  const NEWLINE = '\\n'
  const html = data.replace(new RegExp(NEWLINE, 'g'), ' ')
  const present = is.present({ html, anchor: h.anchor, link: h.target_link })
  if (present) {
    status = 'LIVE'
  } else {
    const linkPresent = is.linkPresent({ html, anchor: h.anchor, link: h.target_link })
    status = linkPresent ? 'LIVE, BUT CORRUPTED ANCHOR' : 'NOT LIVE'
  }
  return status
}

async function status (h, i) {
  const options = { headers: { 'User-Agent': userAgent }, timeout: TIMEOUT }
  return await axios.get(h.url, options)
    .then(res => {
      return statusFromData(h, res.data)
    })
    .catch(e => {
      if (e.response) {
        const status = e.response.status
        const statusText = e.response.statusText.toUpperCase()
        if (status === 406) {
          return statusFromData(h, e.response.data)
        }
        if (status === 403 && e.response.headers.server === 'cloudflare') {
          return 'CLOUDFLARE CAPTCHA'
        }
        return statusText || status
      } else {
        if (e.code === undefined) {
          console.log(e)
        }
        return e.code
      }
    })
}

const normalize = {}

normalize.html = function (x) {
  const qU = String.fromCharCode(8217)
  const qReg = new RegExp(qU, 'g')
  const q = String.fromCharCode(39)
  const nbsp = String.fromCharCode(160)
  return unescape(_.unescape(x.trim()).toLowerCase())
    .replace(qReg, q)
    .replace(nbsp, ' ')
    .replace(/  +/g, ' ')
    .replace('&rsquo;', q)
    .replace(String.fromCharCode(233), 'e')
    .replace('–', '-')
}

normalize.link = function (s) {
  return s.replace(/https?:\/\//, '').replace(/www\./, '').replace(/\/$/, '')
}

const extract = {}

// ::String -> [Tag]
extract.aTags = function (html) {
  let arr
  const regex = /<a\s(.*?)<\/a>/g// regex to retreive data in tag <a>
  const res = []
  while ((arr = regex.exec(html)) !== null) {
    res.push(arr[0])
  }
  return res
}

extract.linksAndAnchors = function (x) {
  let anchor, link, res
  res = />(.*?)<\/a>/.exec(x)
  if (_.isNull(res)) { anchor = '' } else { anchor = res[1] };
  res = /href=(.*?)[ |>]/.exec(x)
  if (_.isNull(res)) { link = '' } else { link = res[1].replace(/"/g, '') }
  return { anchor, link }
}

// ::{:anchor :html} ->[ATag]
extract.valuedTags = function (a) {
  const p = normalize.html(a.anchor.toLowerCase())
  const aTags = extract.aTags(a.html)
  const valuedTags = aTags.filter(function (x) {
    const s = normalize.html(x)
    return s.indexOf(p) > -1
  })
  return valuedTags
}

const is = {}
// ::{:html :link}->Bool
is.linkPresent = function (a) {
  const tags = extract.aTags(a.html)
  const xs = tags.map(extract.linksAndAnchors)
  const linkTemplate = normalize.link(a.link)
  const regex = new RegExp(linkTemplate)
  const properLinkTags = xs.filter(function (x) {
    const siteLink = normalize.link(x.link)
    return regex.test(siteLink)
  })
  return properLinkTags.length > 0
}

// ::{link: anchor: html:} -> Bool
is.present = function (a) {
  const valuedTags = extract.valuedTags(a)// ::->[ATag] all <a> tags which contained anchor
  if (valuedTags.length === 0) return false
  // here we have links only with anchor text
  const xs = valuedTags.map(extract.linksAndAnchors)
  const linkTemplate = normalize.link(a.link)
  const regex = new RegExp(linkTemplate)
  return xs.some(function (x) {
    const siteLink = normalize.link(x.link)
    return regex.test(siteLink)
  })
}

exports.status = status
exports.statusUnderCaptcha = statusUnderCaptcha
