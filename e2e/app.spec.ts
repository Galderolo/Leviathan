import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, Sandbox } from './app'

let box: Sandbox
let app: ElectronApplication | undefined
let page: Page

test.beforeEach(() => {
  box = new Sandbox()
})

test.afterEach(async ({}, info) => {
  if (app && info.status !== info.expectedStatus) {
    await info.attach('window', { body: await page.screenshot(), contentType: 'image/png' }).catch(() => {})
  }
  await app?.close().catch(() => {})
  app = undefined
  box.dispose()
})

async function open(...repos: string[]): Promise<Page> {
  ;({ app, page } = await launch(box, repos))
  return page
}

const commitRows = () => page.locator('.graph-row.row-commit')
const unstaged = () => page.locator('.file-section').nth(0)
const toolbarButton = (label: string) => page.locator('.tool-button', { hasText: label }).locator('.tool-main')
const menuItem = (label: string | RegExp) => page.locator('.context-menu').getByText(label, { exact: true })

test('opens a repository with its history and its uncommitted changes', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.write(repo, { 'a.txt': 'two\n' })
  box.git(repo, 'commit', '-qam', 'second')
  box.write(repo, { 'a.txt': 'three\n', 'new.txt': 'new\n' })
  await open(repo)

  await expect(commitRows()).toHaveCount(2)
  await expect(commitRows().first()).toContainText('second')
  await expect(page.locator('.tab.active')).toContainText('game')
  await page.locator('.graph-row.row-wip').click()
  await expect(unstaged().locator('.file-row')).toHaveCount(2)
})

test('reorders the tabs by dragging them, and keeps the order for the next start', async () => {
  const repos = ['alpha', 'beta', 'gamma'].map((name) => box.repo(name, { 'a.txt': `${name}\n` }))
  await open(...repos)

  const tab = (name: string) => page.locator('.tab', { hasText: name })
  const gamma = await tab('gamma').boundingBox()
  // Onto the right half of the last tab: after it.
  await tab('alpha').dragTo(tab('gamma'), { targetPosition: { x: gamma!.width - 5, y: gamma!.height / 2 } })
  await expect(page.locator('.tab-title')).toHaveText(['beta', 'gamma', 'alpha'])
  // Onto the left half of the first tab: before it.
  await tab('gamma').dragTo(tab('beta'), { targetPosition: { x: 5, y: gamma!.height / 2 } })
  await expect(page.locator('.tab-title')).toHaveText(['gamma', 'beta', 'alpha'])

  const saved = () => JSON.parse(readFileSync(join(box.profile, 'settings.json'), 'utf8')).openTabs as string[]
  await expect.poll(() => saved().map((path) => path.split(/[\\/]/).pop())).toEqual(['gamma', 'beta', 'alpha'])
})

test('marks the tabs whose repository has commits to pull or to push', async () => {
  const origin = join(box.root, 'origin.git')
  box.git(box.root, 'init', '-q', '--bare', '-b', 'main', origin)
  const game = box.repo('game', { 'a.txt': 'one\n' })
  box.git(game, 'remote', 'add', 'origin', origin)
  box.git(game, 'push', '-q', '-u', 'origin', 'main')
  const other = join(box.root, 'other')
  box.git(box.root, 'clone', '-q', origin, other)
  box.write(other, { 'b.txt': 'theirs\n' })
  box.git(other, 'add', '.')
  box.git(other, 'commit', '-qm', 'theirs')
  box.git(other, 'push', '-q')
  box.git(game, 'fetch', '-q')
  for (const name of ['c', 'd']) {
    box.write(game, { [`${name}.txt`]: 'mine\n' })
    box.git(game, 'add', '.')
    box.git(game, 'commit', '-qm', name)
  }
  const tool = box.repo('tool', { 'a.txt': 'one\n' })
  await open(tool, game)

  // Not the tab showing: it is marked all the same, pulling first.
  const gameTab = page.locator('.tab', { hasText: 'game' })
  await expect(gameTab).toHaveClass(/needs-pull/)
  await expect(gameTab.locator('.ab-badge.behind')).toHaveText('1')
  await expect(gameTab.locator('.ab-badge.ahead')).toHaveText('2')
  await expect(gameTab).toHaveAttribute('title', /1 commit to pull\n2 commits to push/)
  const toolTab = page.locator('.tab', { hasText: 'tool' })
  await expect(toolTab).not.toHaveClass(/needs-/)
  await expect(toolTab.locator('.ab-badge')).toHaveCount(0)
})

test('never runs a git.exe that a repository has at its root', async () => {
  test.skip(process.platform !== 'win32', 'only Windows looks for programs in the working folder')
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  // Planted last: the test's own git commands run in this folder too. A harmless program stands in for a hostile
  // one; if it ran instead of git, the repository would not load.
  copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), join(repo, 'git.exe'))
  // Started as on a usual machine, where nothing turned that search off.
  for (const key of Object.keys(box.env)) {
    if (key.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete box.env[key]
  }
  await open(repo)

  await expect(commitRows()).toHaveCount(1)
  await expect(unstaged().locator('.file-row', { hasText: 'git.exe' })).toHaveCount(1)
})

test('stages the changes and commits them', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.write(repo, { 'a.txt': 'two\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await page.getByRole('button', { name: 'Stage all changes' }).click()
  await expect(page.locator('.file-section').nth(1).locator('.file-row')).toHaveCount(1)
  await page.locator('.summary-input').fill('Change a')
  await page.locator('.btn-commit').click()

  await expect(commitRows()).toHaveCount(2)
  await expect(commitRows().first()).toContainText('Change a')
  expect(box.git(repo, 'status', '--porcelain')).toBe('')
})

test('creates a branch and switches between branches', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)

  await toolbarButton('Branch').click()
  await page.locator('.modal input').first().fill('feature/rising')
  await page.locator('.modal .btn-primary').click()
  await expect.poll(() => box.branch(repo)).toBe('feature/rising')

  await page.locator('.left-panel').getByText('main', { exact: true }).dblclick()
  await expect.poll(() => box.branch(repo)).toBe('main')
})

test('stashes the changes and pops them back', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.write(repo, { 'a.txt': 'mine\n', 'new.txt': 'new\n' })
  await open(repo)

  await toolbarButton('Stash').click()
  // As a user would: the stash shows in the graph before Pop is pressed.
  await expect(page.locator('.graph-row.row-stash')).toHaveCount(1)
  expect(box.git(repo, 'stash', 'list').split('\n').filter(Boolean)).toHaveLength(1)
  expect(box.git(repo, 'status', '--porcelain')).toBe('')

  await toolbarButton('Pop').click()
  // git drops the stash only once all of it is back, new files included (they come a moment after the others).
  await expect.poll(() => box.git(repo, 'stash', 'list')).toBe('')
  expect(box.read(repo, 'a.txt')).toBe('mine\n')
  expect(box.read(repo, 'new.txt')).toBe('new\n')
})

test('shows a merge stopped by a conflict, and aborts it', async () => {
  const repo = box.repo('game', { 'a.txt': 'base\n' })
  box.git(repo, 'checkout', '-qb', 'other')
  box.write(repo, { 'a.txt': 'theirs\n' })
  box.git(repo, 'commit', '-qam', 'theirs')
  box.git(repo, 'checkout', '-q', 'main')
  box.write(repo, { 'a.txt': 'ours\n' })
  box.git(repo, 'commit', '-qam', 'ours')
  try {
    box.git(repo, 'merge', 'other')
  } catch {
    // stops for the conflict
  }
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await expect(page.getByText('Merge in progress')).toBeVisible()
  await page.getByRole('button', { name: 'Abort' }).click()
  await expect(page.getByText('Merge in progress')).toHaveCount(0)
  expect(box.read(repo, 'a.txt')).toBe('ours\n')
})

test('asks with a count, not a list, before discarding many files', async () => {
  const files = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`Packages/dir/file${i}.class`, 'a\n']))
  const repo = box.repo('game', files)
  box.write(repo, Object.fromEntries(Object.keys(files).map((f) => [f, 'b\n'])))
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-section-header input[type=checkbox]').click()
  await unstaged().locator('.file-row').first().click({ button: 'right' })
  await menuItem('Discard changes in 26 files').click()
  await expect(page.locator('.modal')).toContainText('Discard the changes in 26 files?')
  await expect(page.locator('.modal')).not.toContainText('file0.class')
  await page.locator('.modal .btn', { hasText: 'Cancel' }).click()
  expect(box.read(repo, 'Packages/dir/file0.class')).toBe('b\n')
})

test('offers to stash my changes when a stash to pop changes the same files', async () => {
  const repo = box.repo('game', { 'SlotInfo.cs': 'base\n', 'other.txt': 'base\n' })
  box.write(repo, { 'SlotInfo.cs': 'stashed\n' })
  box.git(repo, 'stash', '-q')
  box.write(repo, { 'SlotInfo.cs': 'mine\n', 'other.txt': 'mine\n' })
  await open(repo)

  await toolbarButton('Pop').click()
  await expect(page.locator('.modal')).toContainText('SlotInfo.cs has uncommitted changes')
  await page.locator('.modal .btn', { hasText: 'Stash mine and apply' }).click()

  await expect.poll(() => box.read(repo, 'SlotInfo.cs')).toBe('stashed\n')
  expect(box.read(repo, 'other.txt')).toBe('mine\n')
  expect(box.git(repo, 'show', 'stash@{0}:SlotInfo.cs')).toBe('mine')
})

test('keeps Settings in sections and saves each change at once', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)

  await page.locator('.toolbar-right .icon-btn').click()
  await expect(page.locator('.settings-nav-item')).toHaveText([
    'General',
    'External tools',
    'Accounts',
    'SSH keys',
    'Updates',
    'About'
  ])
  await page.locator('.settings-body:visible select').first().selectOption('light')
  await expect.poll(async () => (await page.evaluate(() => window.leviathan.getSettings())).theme).toBe('light')
  await page.locator('.settings-nav-item', { hasText: 'Accounts' }).click()
  await expect(page.locator('.settings-body:visible')).toContainText('Sign in with GitLab')
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal.settings')).toHaveCount(0)
})

test('opens the terminal chosen in Settings in the repository folder', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  // A stand-in terminal: it writes down where it started and what it was given, then exits.
  const marker = join(box.root, 'terminal.json')
  const fake = join(box.root, 'fake-terminal.cjs')
  writeFileSync(
    fake,
    `require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ cwd: process.cwd(), folder: process.argv[2] }))\n`
  )
  await open(repo)

  await page.locator('.toolbar-right .icon-btn').click()
  await page.locator('.settings-nav-item', { hasText: 'External tools' }).click()
  await page.locator('label.field', { hasText: 'Terminal' }).locator('select').selectOption('custom')
  const command = page.locator('label.field', { hasText: "started in the repository's folder" }).locator('input')
  await command.fill(`"${process.execPath}" "${fake}" {folder}`)
  await command.blur()
  await expect
    .poll(async () => (await page.evaluate(() => window.leviathan.getSettings())).terminal)
    .toContain('fake-terminal')
  await page.keyboard.press('Escape')

  await toolbarButton('Terminal').click()
  await expect.poll(() => existsSync(marker)).toBe(true)
  const started = JSON.parse(readFileSync(marker, 'utf8')) as { cwd: string; folder: string }
  const same = (p: string) => realpathSync.native(p).toLowerCase()
  expect(same(started.cwd)).toBe(same(repo))
  expect(same(started.folder)).toBe(same(repo))
})

test("shows a folder's history with the files each commit changed there, and goes up to its parent", async () => {
  const repo = box.repo('game', { 'Assets/UI/Menu.cs': 'class Menu {}\n', 'README.md': 'game\n' })
  const commit = (message: string, files: Record<string, string>) => {
    box.write(repo, files)
    box.git(repo, 'add', '.')
    box.git(repo, 'commit', '-q', '-m', message)
  }
  commit('Describe the game', { 'README.md': 'a game\n' })
  commit('Add the HUD', { 'Assets/Hud.cs': 'class Hud {}\n', 'Assets/UI/Menu.cs': 'class Menu { int page; }\n' })
  box.write(repo, { 'Assets/UI/Menu.cs': 'class Menu { int page = 1; }\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'Menu.cs' }).click({ button: 'right' })
  await menuItem('Folder history').click()
  const view = page.locator('.folder-history')
  await expect(view.locator('.history-subject')).toHaveText(['Add the HUD', 'first'])
  // Only what changed in Assets/UI, its path inside the folder.
  await expect(view.locator('.folder-files .file-path')).toHaveText(['Menu.cs'])
  await expect(view.locator('.diff-line.add .code')).toHaveText(['class Menu { int page; }'])

  await view.locator('.path-step', { hasText: 'Assets/' }).click()
  await expect(view.locator('.diff-title')).toContainText('Assets')
  await expect(view.locator('.folder-files .file-path')).toHaveText(['Hud.cs', 'UI/Menu.cs'])
  await view.locator('.history-row', { hasText: 'first' }).click()
  await expect(view.locator('.folder-files .file-path')).toHaveText(['UI/Menu.cs'])
})

test('highlights the code of a diff', async () => {
  const repo = box.repo('game', { 'Assets/Player.cs': 'public class Player\n{\n    int hp = 1;\n}\n' })
  box.write(repo, { 'Assets/Player.cs': 'public class Player\n{\n    int hp = 2; // more\n}\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'Player.cs' }).click()
  await expect(page.locator('.diff-view .code .hljs-keyword').first()).toBeVisible()
  await expect(page.locator('.diff-view .code .hljs-comment')).toHaveText('// more')
  // The changed number is still marked inside the highlighted line.
  await expect(page.locator('.diff-line.add mark.word-change').first()).toContainText('2')
})

test('shows the whole file around a change, and still stages its hunk', async () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
  const repo = box.repo('game', { 'f.txt': lines.join('\n') + '\n' })
  lines[9] = 'changed 10'
  box.write(repo, { 'f.txt': lines.join('\n') + '\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'f.txt' }).click()
  const view = page.locator('.diff-view')
  await expect(view.locator('.hunk .diff-line')).toHaveCount(8)
  await expect(view.locator('.gap-lines')).toHaveCount(0)

  await view.getByTitle('Whole file').click()
  // Lines 1-6 before the hunk (7-13), 14-20 after it.
  await expect(view.locator('.gap-lines')).toHaveCount(2)
  await expect(view.locator('.gap-lines .diff-line')).toHaveCount(13)
  await expect(view.locator('.gap-lines .diff-line .code').first()).toHaveText('line 1')
  await view.getByTitle('Side by side (old | new)').click()
  await expect(view.locator('.gap-lines .split-row')).toHaveCount(13)
  await view.getByTitle('One column').click()

  await view.getByRole('button', { name: 'Stage hunk' }).click()
  await expect.poll(() => box.git(repo, 'diff', '--cached', '--name-only')).toBe('f.txt')
  expect(box.git(repo, 'diff', '--name-only')).toBe('')
})

/** A repository with `base` and then commits one, two and three, each adding its own file. */
function threeCommits(): string {
  const repo = box.repo('game', { 'base.txt': 'base\n' })
  for (const name of ['one', 'two', 'three']) {
    box.write(repo, { [`${name}.txt`]: `${name}\n` })
    box.git(repo, 'add', '.')
    box.git(repo, 'commit', '-qm', name)
  }
  return repo
}

async function openRebaseFromBase(): Promise<void> {
  await commitRows().filter({ hasText: 'first' }).click({ button: 'right' })
  await menuItem('Interactive rebase from here…').click()
  await expect(page.locator('.rebase-row')).toHaveCount(3)
}

test('reorders commits by dragging them in the interactive rebase', async () => {
  const repo = threeCommits()
  await open(repo)
  await openRebaseFromBase()

  // Newest first: drag "one" (bottom) above "three" (top).
  const row = (subject: string) => page.locator('.rebase-row', { hasText: subject })
  await row('one').locator('.rebase-grip').dragTo(row('three'))
  await expect(page.locator('.rebase-subject')).toHaveText(['one', 'three', 'two'])
  await page.getByRole('button', { name: 'Start rebase' }).click()

  await expect.poll(() => box.git(repo, 'log', '--format=%s', '-3')).toBe('one\nthree\ntwo')
})

test('stops at a commit to edit it, and goes on after amending it', async () => {
  const repo = threeCommits()
  await open(repo)
  await openRebaseFromBase()

  await page.locator('.rebase-row', { hasText: 'two' }).locator('select').selectOption('edit')
  await page.getByRole('button', { name: 'Start rebase' }).click()
  await page.locator('.graph-row.row-wip').click()
  await expect(page.locator('.op-banner')).toContainText('so you can change it')

  box.write(repo, { 'two.txt': 'two, edited\n' })
  await expect(unstaged().locator('.file-row', { hasText: 'two.txt' })).toBeVisible()
  await page.getByRole('button', { name: 'Stage all changes' }).click()
  await expect(page.locator('.file-section').nth(1).locator('.file-row')).toHaveCount(1)
  // Turning amend on loads the commit's message first.
  const amend = page.locator('.commit-box input[type=checkbox]')
  await amend.click()
  await expect(amend).toBeChecked()
  await expect(page.locator('.summary-input')).toHaveValue('two')
  await page.locator('.summary-input').fill('two, edited')
  await page.locator('.btn-commit').click()
  await expect.poll(() => box.git(repo, 'log', '--format=%s', '-1')).toBe('two, edited')
  await page.locator('.op-banner').getByRole('button', { name: 'Continue' }).click()

  await expect(page.locator('.op-banner')).toHaveCount(0)
  expect(box.git(repo, 'log', '--format=%s', '-3')).toBe('three\ntwo, edited\none')
  expect(box.git(repo, 'show', 'HEAD~1:two.txt')).toBe('two, edited')
})

test('reviews a pull request: its files and diff, its conversation, approving and merging it', async () => {
  // Accounts need the system's secure storage, which a Linux runner without a keyring does not have (the app
  // refuses to keep tokens only obfuscated). Windows and macOS cover this test.
  test.skip(process.platform === 'linux' && !!process.env.CI, 'no keyring for the account token')
  // origin looks like GitHub but a fake ssh serves it from a local bare repository; GitHub's API is a stub in the
  // main process. Nothing leaves the machine.
  const origin = join(box.root, 'origin.git')
  box.git(box.root, 'init', '-q', '--bare', '-b', 'main', origin)
  const contrib = box.repo('contrib', { 'Assets/Login.cs': 'public class Login\n{\n    int tries = 3;\n}\n' })
  box.git(contrib, 'remote', 'add', 'origin', origin)
  box.git(contrib, 'push', '-q', 'origin', 'main')
  box.git(contrib, 'checkout', '-qb', 'login')
  box.write(contrib, { 'Assets/Login.cs': 'public class Login\n{\n    int tries = 5;\n}\n', 'NOTES.md': 'notes\n' })
  box.git(contrib, 'add', '.')
  box.git(contrib, 'commit', '-qm', 'Remember the user')
  box.git(contrib, 'push', '-q', 'origin', 'login', 'login:refs/pull/12/head')
  const work = join(box.root, 'work')
  box.git(box.root, 'clone', '-q', origin, work)
  box.git(work, 'remote', 'set-url', 'origin', 'git@github.com:org/app.git')
  const fakeSsh = join(box.root, 'fake-ssh.sh')
  const slashes = (p: string) => p.split('\\').join('/')
  writeFileSync(fakeSsh, `#!/bin/sh\nexec git upload-pack "${slashes(origin)}"\n`)
  box.env.GIT_SSH_COMMAND = `sh "${slashes(fakeSsh)}"`
  await open(work)

  await app!.evaluate(() => {
    const pr = {
      number: 12,
      title: 'Remember the user',
      user: { login: 'ana' },
      head: { ref: 'login', repo: { full_name: 'org/app' } },
      base: { ref: 'main', repo: { full_name: 'org/app' } },
      draft: false,
      html_url: 'https://github.com/org/app/pull/12',
      updated_at: '2026-10-22T10:00:00Z'
    }
    const api = 'https://api.github.com'
    const routes: Record<string, unknown> = {
      [`GET ${api}/user`]: { login: 'me', id: 7, name: 'Me' },
      [`GET ${api}/repos/org/app/pulls/12`]: pr,
      [`GET ${api}/repos/org/app/issues/12/comments?per_page=100`]: [
        { id: 1, user: { login: 'bo' }, body: 'Can we keep 3 tries?', created_at: '2026-10-22T11:00:00Z' }
      ],
      [`GET ${api}/repos/org/app/pulls/12/comments?per_page=100`]: [],
      [`GET ${api}/repos/org/app/pulls/12/reviews?per_page=100`]: [],
      [`POST ${api}/repos/org/app/issues/12/comments`]: { id: 3, user: { login: 'me' }, body: 'Fine', created_at: 'x' },
      [`POST ${api}/repos/org/app/pulls/12/reviews`]: {},
      [`PUT ${api}/repos/org/app/pulls/12/merge`]: { merged: true }
    }
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).__calls = calls
    globalThis.fetch = (async (url: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method ?? 'GET'
      calls.push(`${method} ${url} ${init.body ?? ''}`.trim())
      let body = routes[`${method} ${url}`]
      if (body === undefined && url.startsWith(`${api}/repos/org/app/pulls?`)) body = [pr]
      // A project that takes no merge commits.
      if (body === undefined && url === `${api}/repos/org/app`) {
        body = { default_branch: 'main', allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: true }
      }
      const status = body === undefined ? 404 : 200
      return { ok: status < 400, status, json: async () => body ?? {} }
    }) as unknown as typeof fetch
  })
  await page.evaluate(() => window.leviathan.addAccount({ provider: 'github', host: 'github.com', token: 'fake' }))
  await page.evaluate(() => location.reload())

  await page.locator('.left-panel').getByText('Remember the user').click({ button: 'right' })
  await menuItem('Review').click()
  await expect(page.locator('.review-view .history-list .file-row')).toHaveText([/Login\.cs/, /NOTES\.md/])
  await expect(page.locator('.review-view .diff-line.add .code')).toHaveText(['    int tries = 5;'])
  expect(box.branch(work)).toBe('main')

  await page.locator('.review-tab', { hasText: 'Conversation' }).click()
  await expect(page.locator('.review-comment')).toHaveCount(1)
  await page.locator('.review-reply textarea').fill('Fine')
  await page.locator('.review-reply .btn-primary').click()
  await expect(page.locator('.review-comment')).toHaveCount(2)
  await page.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('button', { name: 'Merge…' }).click()
  // Only the methods the project allows, the first of them chosen.
  await expect(page.locator('.modal select')).toHaveValue('squash')
  expect(
    await page.locator('.modal select option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
  ).toEqual(['squash', 'rebase'])
  await page.locator('.modal .btn-primary').click()
  await expect(page.locator('.review-view')).toHaveCount(0)
  // The ref that held the pull request's commits for the review is gone with it.
  await expect.poll(() => box.git(work, 'for-each-ref', 'refs/leviathan/review/')).toBe('')

  const writes = await app!.evaluate(() =>
    ((globalThis as Record<string, unknown>).__calls as string[]).filter((c) => !c.startsWith('GET'))
  )
  // Approving and merging name the reviewed commit, so the server refuses if the pull request moved on.
  const head = box.git(contrib, 'rev-parse', 'login')
  expect(writes).toEqual([
    'POST https://api.github.com/repos/org/app/issues/12/comments {"body":"Fine"}',
    `POST https://api.github.com/repos/org/app/pulls/12/reviews {"event":"APPROVE","commit_id":"${head}"}`,
    `PUT https://api.github.com/repos/org/app/pulls/12/merge {"merge_method":"squash","sha":"${head}"}`
  ])
})

test('offers to pull and push again when the remote has commits that are not here yet', async () => {
  const origin = join(box.root, 'origin.git')
  box.git(box.root, 'init', '-q', '--bare', '-b', 'main', origin)
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.git(repo, 'remote', 'add', 'origin', origin)
  box.git(repo, 'push', '-q', '-u', 'origin', 'main')
  // Someone else pushes first.
  const other = join(box.root, 'other')
  box.git(box.root, 'clone', '-q', origin, other)
  box.write(other, { 'b.txt': 'theirs\n' })
  box.git(other, 'add', '.')
  box.git(other, 'commit', '-qm', 'theirs')
  box.git(other, 'push', '-q')
  box.write(repo, { 'c.txt': 'mine\n' })
  box.git(repo, 'add', '.')
  box.git(repo, 'commit', '-qm', 'mine')
  await open(repo)

  await toolbarButton('Push').click()
  await expect(page.locator('.modal')).toContainText('has commits on the remote that are not here yet')
  await page.locator('.modal .btn-primary').click()

  await expect.poll(() => box.git(origin, 'log', '--format=%s', 'main')).toContain('mine')
  expect(box.git(origin, 'log', '--format=%s', 'main')).toContain('theirs')
})

test('pulls after a background fetch that is running, instead of failing to lock the refs', async () => {
  const origin = join(box.root, 'origin.git')
  box.git(box.root, 'init', '-q', '--bare', '-b', 'main', origin)
  const work = box.repo('game', { 'a.txt': 'one\n' })
  box.git(work, 'remote', 'add', 'origin', origin)
  box.git(work, 'push', '-q', '-u', 'origin', 'main')
  const other = join(box.root, 'other')
  box.git(box.root, 'clone', '-q', origin, other)
  box.write(other, { 'b.txt': 'theirs\n' })
  box.git(other, 'add', '.')
  box.git(other, 'commit', '-qm', 'theirs')
  box.git(other, 'push', '-q')
  // A remote that notes when each connection starts and ends, and holds a connection until a second one comes
  // (6 s at most): two fetches at once run side by side, as in a race that fails to lock refs/remotes/origin/main.
  const log = join(box.root, 'connections.txt')
  const fakeSsh = join(box.root, 'slow-ssh.sh')
  const slashes = (p: string) => p.split('\\').join('/')
  writeFileSync(
    fakeSsh,
    [
      '#!/bin/sh',
      `echo start >> "${slashes(log)}"`,
      'i=0',
      `while [ "$(grep -c start "${slashes(log)}")" -lt 2 ] && [ $i -lt 60 ]; do sleep 0.1; i=$((i + 1)); done`,
      `git upload-pack "${slashes(origin)}"`,
      'status=$?',
      `echo done >> "${slashes(log)}"`,
      'exit $status',
      ''
    ].join('\n')
  )
  box.env.GIT_SSH_COMMAND = `sh "${slashes(fakeSsh)}"`
  box.git(work, 'remote', 'set-url', 'origin', 'git@example.invalid:game.git')
  // No `ssh -G` probe before each connection: it would count as one.
  box.git(work, 'config', 'ssh.variant', 'ssh')
  ;({ app, page } = await launch(box, [work], { autoFetchMinutes: 1 }))

  // The first background fetch starts a few seconds after the window.
  await expect.poll(() => existsSync(log), { timeout: 20_000 }).toBe(true)
  await toolbarButton('Pull').click()

  const steps = () => readFileSync(log, 'utf8').split('\n').filter(Boolean)
  await expect.poll(() => steps().length, { timeout: 20_000 }).toBe(4)
  // The pull's fetch waited for the background one.
  expect(steps()).toEqual(['start', 'done', 'start', 'done'])
  await expect.poll(() => box.git(work, 'log', '--format=%s', '-1')).toBe('theirs')
  await expect(page.locator('.toast.error')).toHaveCount(0)
  await expect(page.locator('.status-warning')).toHaveCount(0)
})

test('generates an SSH key protected by its passphrase', async () => {
  // The app's home, so the key goes nowhere near the real ~/.ssh.
  const home = join(box.root, 'home')
  mkdirSync(home)
  box.env.HOME = home
  box.env.USERPROFILE = home
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)

  await page.locator('.toolbar-right .icon-btn').click()
  await page.locator('.settings-nav-item', { hasText: 'SSH keys' }).click()
  await page.getByRole('button', { name: 'Generate new key' }).click()
  const passphrase = 'correct horse & "battery" %PATH%'
  await page.getByLabel('Email (key comment)').fill('ana@example.com')
  await page.getByLabel('Passphrase (optional)').fill(passphrase)
  await page.getByRole('button', { name: 'Create' }).click()

  const key = join(home, '.ssh', 'id_ed25519')
  await expect.poll(() => existsSync(`${key}.pub`)).toBe(true)
  const opens = (given: string) =>
    spawnSync('ssh-keygen', ['-y', '-P', given, '-f', key], { stdio: 'ignore' }).status === 0
  expect(opens('')).toBe(false)
  expect(opens(passphrase)).toBe(true)
  await expect(page.locator('.toast.error')).toHaveCount(0)
})
