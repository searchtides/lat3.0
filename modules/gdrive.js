const path = require('path')
const fsa = require('fs').promises
const fs = require('fs')
const { google } = require('googleapis')
const TOKEN_PATH = 'operational/token.json'

async function getClient () {
  const content = await fsa.readFile('operational/credentials.json', 'utf8')
  return getOAuth2Client(JSON.parse(content))
}

async function getOAuth2Client (credentials) {
  let token
  const { clientSecret, clientId, redirectUris } = credentials.installed
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUris[0])
  let tokenExists = true
  try {
    token = await fsa.readFile(TOKEN_PATH, 'utf8')
  } catch (e) {
    tokenExists = false
  }
  if (!tokenExists) {
    // TODO getAccessToken function (maybe)
    Promise.reject(new Error('no token found'))
  }
  oAuth2Client.setCredentials(JSON.parse(token))
  return Promise.resolve(oAuth2Client)
}

function createFolder (auth, name, folderId) {
  const fileMetadata = { name, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] }
  const drive = google.drive({ version: 'v3', auth })
  return new Promise((resolve, reject) => {
    drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    }, function (err, file) {
      if (err) {
        reject(err)
      } else {
        resolve(file.data.id)
      }
    })
  })
}

function addFileToFolder (auth, fullName, mimeType, folderId) {
  const fileMetadata = { name: path.basename(fullName), parents: [folderId] }
  const drive = google.drive({ version: 'v3', auth })
  const media = {
    mimeType,
    body: fs.createReadStream(fullName)
  }

  return new Promise((resolve, reject) => {
    drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id'
    }, function (err, file) {
      if (err) {
        reject(err)
      } else {
        resolve(file.data.id)
      }
    })
  })
}

async function uploadFolder (pathToFolder, parentId) {
  const folderName = path.basename(pathToFolder)
  const files = await fsa.readdir(pathToFolder)
  const auth = await getClient()
  const folderId = await createFolder(auth, folderName, parentId)
  const ids = []
  let counter = 1
  for (const file of files) {
    const mimeType = /csv$/.test(file) ? 'text/csv' : 'application/json'
    const fullName = path.join(pathToFolder, file)
    const id = await addFileToFolder(auth, fullName, mimeType, folderId)
    ids.push(id)
    console.log(counter + ': ' + id)
    counter++
  }
  return Promise.resolve(folderId)
}

exports.uploadFolder = uploadFolder
