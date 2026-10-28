import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types'

let settings: Settings = { ...DEFAULT_SETTINGS }
vi.mock('../src/main/settings', () => ({ loadSettings: () => settings }))

const { initRepo } = await import('../src/main/git/repository')
const { git } = await import('../src/main/git/runner')
const { NO_DIFF_TOOL, openDiffTool, openInEditor, openMergeTool, openTerminal } = await import('../src/main/tools')

let dir: string
let log: string
const savedGlobal = process.env.GIT_CONFIG_GLOBAL

beforeAll(() => {
  // No diff or merge tool from the user's own git config.
  const global = mkdtempSync(join(tmpdir(), 'leviathan-tools-global-'))
  process.env.GIT_CONFIG_GLOBAL = join(global, 'global.gitconfig')
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
})

afterAll(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal
})

beforeEach(async () => {
  settings = { ...DEFAULT_SETTINGS }
  dir = await initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-tools-')), 'repo'), 'main')
  log = join(dir, '..', 'calls.log')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
  for (const name of ['[id].txt', 'i.txt']) writeFileSync(join(dir, name), 'one\n')
  await git(['add', '.'], { cwd: dir })
  await git(['commit', '-qm', 'first'], { cwd: dir })
  for (const name of ['[id].txt', 'i.txt']) writeFileSync(join(dir, name), 'two\n')
})

afterEach(() => {
  // A tool git started may still be closing.
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

/** A merge tool only (no diff.tool): git difftool falls back to it. It logs the file it is given. */
async function recordingMergeTool() {
  const script = join(dir, '..', 'record.cjs').replace(/\\/g, '/')
  writeFileSync(script, `require('fs').appendFileSync(${JSON.stringify(log)}, process.argv[2] + '\\n')`)
  await git(['config', 'merge.tool', 'rec'], { cwd: dir })
  await git(['config', 'mergetool.rec.cmd', `node "${script}" "$MERGED"`], { cwd: dir })
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])

/** The calls once git has made them all: openDiffTool returns before slow tools are done, on purpose. */
async function settledCalls(): Promise<string[]> {
  let last = ''
  let quietSince = Date.now()
  for (const start = Date.now(); Date.now() - start < 20000;) {
    await new Promise((r) => setTimeout(r, 100))
    const now = calls().join('\n')
    if (now !== last) {
      last = now
      quietSince = Date.now()
    } else if (now && Date.now() - quietSince > 2000) break
  }
  return calls()
}

describe('external tools', () => {
  it('reports an editor that is not installed', async () => {
    settings.editor = 'leviathan-no-such-editor {file}'
    await expect(openInEditor(dir, 'i.txt')).rejects.toThrow('"leviathan-no-such-editor" was not found')
  })

  it('reports a terminal that is not installed, before anything starts', async () => {
    settings.terminal = 'leviathan-no-such-terminal {folder}'
    await expect(openTerminal(dir)).rejects.toThrow('"leviathan-no-such-terminal" was not found')
  })

  it('refuses to give cmd a folder with % in its path: cmd would read it as a variable', async () => {
    const odd = join(dir, '..', 'game%PATH%x')
    mkdirSync(odd)
    settings.terminal = `"${process.execPath}" {folder}`
    await expect(openTerminal(odd, 'win32')).rejects.toThrow('%')
  })

  // `open -a iTerm` without iTerm exits with an error at once. (Started the macOS and Linux way: on Windows, start
  // would open a window.)
  it('reports a terminal that fails as it starts', async () => {
    settings.terminal = `"${process.execPath}" -e process.exit(3)`
    await expect(openTerminal(dir, 'darwin')).rejects.toThrow('could not be started (exit code 3)')
  })

  it('uses the merge tool for diffs when no diff tool is set, as git difftool does', async () => {
    await recordingMergeTool()
    await openDiffTool(dir, { kind: 'unstaged', path: 'i.txt' })
    expect(await settledCalls()).toEqual(['i.txt'])
  })

  it('says when there is no tool at all instead of letting git pick one', async () => {
    await expect(openDiffTool(dir, { kind: 'unstaged', path: 'i.txt' })).rejects.toThrow(NO_DIFF_TOOL)
  })

  it('takes file names literally: [id].txt is not a pattern matching i.txt', async () => {
    await recordingMergeTool()
    await openDiffTool(dir, { kind: 'unstaged', path: '[id].txt' })
    expect(await settledCalls()).toEqual(['[id].txt'])
  })

  // git mergetool loops over its files unquoted, so its own shell would turn [id].txt into i.txt.
  it('refuses a conflicted file whose name git mergetool would read as a pattern', async () => {
    const script = join(dir, '..', 'resolve.cjs').replace(/\\/g, '/')
    writeFileSync(script, `require('fs').writeFileSync(process.argv[2], 'resolved\\n')`)
    await git(['config', 'merge.tool', 'res'], { cwd: dir })
    await git(['config', 'mergetool.res.cmd', `node "${script}" "$MERGED"`], { cwd: dir })
    await git(['config', 'mergetool.res.trustExitCode', 'true'], { cwd: dir })
    await git(['checkout', '-q', '--', '.'], { cwd: dir })
    await git(['checkout', '-qb', 'other'], { cwd: dir })
    writeFileSync(join(dir, '[id].txt'), 'theirs\n')
    await git(['commit', '-qam', 'theirs'], { cwd: dir })
    await git(['checkout', '-q', 'main'], { cwd: dir })
    writeFileSync(join(dir, '[id].txt'), 'ours\n')
    await git(['commit', '-qam', 'ours'], { cwd: dir })
    await git(['merge', 'other'], { cwd: dir, okCodes: [0, 1] })

    await expect(openMergeTool(dir, '[id].txt')).rejects.toThrow('conflict editor')
    expect(readFileSync(join(dir, '[id].txt'), 'utf8')).toContain('<<<<<<<')
    expect(readFileSync(join(dir, 'i.txt'), 'utf8')).toBe('one\n')
  })

  it('uses the editor and diff tool the repository has of its own', async () => {
    // General ones that do not exist: nothing starts on the computer running the tests either way.
    settings.editor = 'leviathan-general-editor {file}'
    settings.diffTool = 'leviathan-no-such-tool'
    settings.repoSettings = { [dir]: { editor: 'leviathan-repo-editor {file}', diffTool: '' } }
    await expect(openInEditor(dir, 'i.txt')).rejects.toThrow('"leviathan-repo-editor" was not found')
    // No diff tool of its own: the one git has set for it, not the general one.
    await recordingMergeTool()
    await openDiffTool(dir, { kind: 'unstaged', path: 'i.txt' })
    expect(await settledCalls()).toEqual(['i.txt'])
  })

  it('refuses a commit that is not a hash', async () => {
    await recordingMergeTool()
    await expect(
      openDiffTool(dir, { kind: 'commit', hash: '--output=x', parent: null, path: 'i.txt' })
    ).rejects.toThrow('Invalid commit')
    await expect(openDiffTool(dir, { kind: 'commit', hash: 'abc1234', parent: '-p', path: 'i.txt' })).rejects.toThrow(
      'Invalid commit'
    )
  })
})
