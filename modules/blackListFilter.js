const _ = require('underscore')
const main = (domains, blackList) => {
  const blackMap = _.object(blackList, blackList)
  const whiteList = domains.filter(domain => blackMap[domain] === undefined)
  const toRemove = domains.filter(domain => blackMap[domain] !== undefined)
  const succeed = _.object(whiteList, whiteList)
  const blacklisted = _.object(toRemove, toRemove)
  return { right: { succeed, blacklisted } }
}

module.exports = main
