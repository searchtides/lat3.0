const nodemailer = require('nodemailer')
require('dotenv').config()

const auth = {
  user: process.env.USER_NAME,
  pass: process.env.PASS
}

const transporter = nodemailer.createTransport({
  service: process.env.SERVICE,
  auth
})

const send = (text) => {
  const opts = {
    from: process.env.USER_NAME,
    to: 'yyk@mail.ru',
    subject: 'alert from lat3.0',
    text
  }
  return new Promise((resolve, reject) => {
    transporter.sendMail(opts, function (error, info) {
      if (error) {
        reject(error)
      } else {
        resolve('Email sent: ' + info.response)
      }
    })
  })
}

exports.send = send
