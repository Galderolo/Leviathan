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
