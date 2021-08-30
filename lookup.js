const { exec } = require('child_process')
const axios = require('axios')

const getIp = (domain) => {
  return new Promise((resolve, reject) => {
    exec('dig +short ' + domain, (error, stdout, stderr) => {
      if (error) { reject(error) }
      if (stderr) { reject(stderr) }
      const lines = stdout.split('\n')
      resolve(lines[lines.length - 2])
    })
  })
}

exports.country = (domain) => {
  return new Promise((resolve, reject) => {
    getIp(domain)
      .then((ip) => {
        axios.get('http://www.iplocate.io/api/lookup/' + ip)
          .then((x) => {
            resolve({ country: x.data.country })
          })
          .catch(e => reject(e))
      })
  })
}
