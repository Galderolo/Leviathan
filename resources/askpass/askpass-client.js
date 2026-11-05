// Askpass client: sends the prompt to Leviathan's askpass server and prints the answer.
// Runs as plain Node (Electron with ELECTRON_RUN_AS_NODE), so it must stay dependency-free CommonJS.
'use strict'
const http = require('http')

/** Splits a Windows command line into its arguments, as programs built with the C runtime do. */
function windowsArgs(line) {
  const args = []
  let arg = ''
  let started = false
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') {
      let count = 0
      while (line[i] === '\\') {
        count++
        i++
      }
      if (line[i] === '"') {
        // Backslashes before a quote: half of them stay, and an odd one makes the quote a plain character.
        arg += '\\'.repeat(count >> 1)
        if (count % 2) arg += '"'
        else quoted = !quoted
      } else {
        arg += '\\'.repeat(count)
        i--
      }
      started = true
    } else if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        arg += '"'
        i++
      } else quoted = !quoted
      started = true
    } else if ((ch === ' ' || ch === '\t') && !quoted) {
      if (started) args.push(arg)
      arg = ''
      started = false
    } else {
      arg += ch
      started = true
    }
  }
  if (started) args.push(arg)
  return args
}

/**
 * The prompt in the line cmd.exe ran askpass.cmd with (`%CMDCMDLINE%`): `cmd.exe /c C:\...\askpass.cmd "prompt"`
 * from git for Windows' ssh, or `cmd.exe /c ""C:\...\askpass.cmd" "prompt""` (the whole line quoted once more) from
 * Windows' own OpenSSH. Null when the line is not one of those.
 */
function promptFromCmdLine(line) {
  const switchAt = /\s\/c\s+/i.exec(line)
  if (!switchAt) return null
  const start = switchAt.index + switchAt[0].length
  const nameAt = line.toLowerCase().indexOf('askpass.cmd', start)
  if (nameAt < 0) return null
  const lead = line.slice(start, nameAt)
  let rest = line.slice(nameAt + 'askpass.cmd'.length).replace(/[\r\n]+$/, '')
  const pathQuoted = rest.startsWith('"')
  if (pathQuoted) rest = rest.slice(1)
  const wrapped = lead.startsWith('""') || (lead.startsWith('"') && !pathQuoted)
  if (wrapped && rest.endsWith('"')) rest = rest.slice(0, -1)
  return windowsArgs(rest).join(' ')
}

/**
 * The prompt asked: its arguments, or, through askpass.cmd, the whole of it from cmd's own line when that line starts
 * the same way (cmd passes on only an argument's first line).
 */
function askedPrompt(argv, cmdLine) {
  const fromArgs = argv.join(' ')
  const whole = cmdLine ? promptFromCmdLine(cmdLine) : null
  return whole && whole.length > fromArgs.length && whole.startsWith(fromArgs) ? whole : fromArgs
}

function ask(prompt) {
  const body = JSON.stringify({ prompt })
  const req = http.request(
    {
      socketPath: process.env.LEVIATHAN_ASKPASS_HANDLE,
      method: 'POST',
      path: '/',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-leviathan-token': process.env.LEVIATHAN_ASKPASS_TOKEN || '',
        // "accounts" for background work: answer from stored accounts only, never show a window
        'x-leviathan-mode': process.env.LEVIATHAN_ASKPASS_MODE || 'interactive'
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
}

if (require.main === module) ask(askedPrompt(process.argv.slice(2), process.env.LEVIATHAN_ASKPASS_CMDLINE))

module.exports = { askedPrompt, promptFromCmdLine, windowsArgs }
