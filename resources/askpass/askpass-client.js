// Askpass client: sends the prompt to Leviathan's askpass server and prints the answer.
// Runs as plain Node (Electron with ELECTRON_RUN_AS_NODE), so it must stay dependency-free CommonJS.
'use strict'
const http = require('http')

const prompt = process.argv.slice(2).join(' ')
const body = JSON.stringify({ prompt })

const req = http.request(
  {
    socketPath: process.env.LEVIATHAN_ASKPASS_HANDLE,
    method: 'POST',
    path: '/',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'x-leviathan-token': process.env.LEVIATHAN_ASKPASS_TOKEN || ''
    }
  },
  (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => (data += chunk))
    res.on('end', () => {
      try {
        const { answer } = JSON.parse(data)
        if (res.statusCode === 200 && typeof answer === 'string') {
          process.stdout.write(answer + '\n')
          process.exit(0)
        }
      } catch {
        // fall through: treat as cancelled
      }
      process.exit(1)
    })
  }
)
req.on('error', () => process.exit(1))
req.end(body)
