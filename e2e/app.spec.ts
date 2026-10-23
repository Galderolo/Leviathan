import { writeFileSync } from 'node:fs'
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
  await expect.poll(() => box.git(repo, 'branch', '--show-current')).toBe('feature/rising')

  await page.locator('.left-panel').getByText('main', { exact: true }).dblclick()
  await expect.poll(() => box.git(repo, 'branch', '--show-current')).toBe('main')
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
  await expect.poll(() => box.read(repo, 'a.txt')).toBe('mine\n')
  expect(box.read(repo, 'new.txt')).toBe('new\n')
  expect(box.git(repo, 'stash', 'list')).toBe('')
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
      if (body === undefined && url === `${api}/repos/org/app`) body = { default_branch: 'main' }
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
  expect(box.git(work, 'branch', '--show-current')).toBe('main')

  await page.locator('.review-tab', { hasText: 'Conversation' }).click()
  await expect(page.locator('.review-comment')).toHaveCount(1)
  await page.locator('.review-reply textarea').fill('Fine')
  await page.locator('.review-reply .btn-primary').click()
  await expect(page.locator('.review-comment')).toHaveCount(2)
  await page.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('button', { name: 'Merge…' }).click()
  await page.locator('.modal select').selectOption('squash')
  await page.locator('.modal .btn-primary').click()
  await expect(page.locator('.review-view')).toHaveCount(0)

  const writes = await app!.evaluate(() =>
    ((globalThis as Record<string, unknown>).__calls as string[]).filter((c) => !c.startsWith('GET'))
  )
  expect(writes).toEqual([
    'POST https://api.github.com/repos/org/app/issues/12/comments {"body":"Fine"}',
    'POST https://api.github.com/repos/org/app/pulls/12/reviews {"event":"APPROVE"}',
    'PUT https://api.github.com/repos/org/app/pulls/12/merge {"merge_method":"squash"}'
  ])
})
