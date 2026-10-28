import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
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

/**
 * Drags `source` onto `target`, at `at` within it; `marked` (`source` itself by default) takes the class `dragging`
 * once the drag starts. A busy window takes the moves late, all at once, with the release right behind, and no drag
 * starts. So it nudges until the drag has started, then goes on, as a hand would.
 */
async function dragByMouse(
  source: Locator,
  target: Locator,
  at: { x: number; y: number },
  marked: Locator = source
): Promise<void> {
  const from = (await source.boundingBox())!
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  let nudge = 0
  await expect(async () => {
    nudge += 6
    await page.mouse.move(x + nudge, y, { steps: 2 })
    await expect(marked).toHaveClass(/dragging/, { timeout: 500 })
  }).toPass({ timeout: 10_000 })
  const to = (await target.boundingBox())!
  await page.mouse.move(to.x + at.x, to.y + at.y, { steps: 5 })
  await page.mouse.up()
}

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
  const gamma = (await tab('gamma').boundingBox())!
  // Onto the right half of the last tab: after it.
  await dragByMouse(tab('alpha'), tab('gamma'), { x: gamma.width - 5, y: gamma.height / 2 })
  await expect(page.locator('.tab-title')).toHaveText(['beta', 'gamma', 'alpha'])
  // Onto the left half of the first tab: before it.
  await dragByMouse(tab('gamma'), tab('beta'), { x: 5, y: gamma.height / 2 })
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

  // Not the tab showing: it has the counts all the same.
  const gameTab = page.locator('.tab', { hasText: 'game' })
  await expect(gameTab.locator('.ab-badge.behind')).toHaveText('1')
  await expect(gameTab.locator('.ab-badge.ahead')).toHaveText('2')
  await expect(gameTab).toHaveAttribute('title', /1 commit to pull\n2 commits to push/)
  // Only the tab showing stands out: no tint nor coloured edge that could pass for it.
  await expect(gameTab).toHaveCSS('background-image', 'none')
  await expect(gameTab).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  const toolTab = page.locator('.tab', { hasText: 'tool' })
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
  // While it drops it, refs/stash is half gone and git fails to list it: poll for an answer, not an error.
  const stashes = () => spawnSync('git', ['stash', 'list'], { cwd: repo, env: box.env, encoding: 'utf8' }).stdout
  await expect.poll(stashes).toBe('')
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

test('leaves the conflict editor for the staged file when it is marked resolved from the list', async () => {
  const repo = twoConflicts()
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  await page.locator('.file-row', { hasText: 'a.txt' }).first().click()
  await expect(page.locator('.conflict-block')).toHaveCount(2)

  await page.locator('.file-row', { hasText: 'a.txt' }).first().click({ button: 'right' })
  await menuItem('Mark resolved').click()
  await expect(page.locator('.conflict-block')).toHaveCount(0)
  await expect(page.locator('.diff-view .diff-context')).toHaveText('Staged')
})

test('takes one side of a conflicted file at once, but asks first when the file was edited', async () => {
  const repo = box.repo('game', { 'a.txt': 'base\n', 'b.txt': 'base\n' })
  box.git(repo, 'checkout', '-qb', 'other')
  box.write(repo, { 'a.txt': 'theirs\n', 'b.txt': 'theirs\n' })
  box.git(repo, 'commit', '-qam', 'theirs')
  box.git(repo, 'checkout', '-q', 'main')
  box.write(repo, { 'a.txt': 'ours\n', 'b.txt': 'ours\n' })
  box.git(repo, 'commit', '-qam', 'ours')
  try {
    box.git(repo, 'merge', 'other')
  } catch {
    // stops for the conflicts
  }
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  const take = (label: string) => page.locator('.diff-actions').getByRole('button', { name: label })

  // As git left it: nothing to lose.
  await page.locator('.file-row', { hasText: 'a.txt' }).first().click()
  await take('Take current file').click()
  await expect.poll(() => box.read(repo, 'a.txt')).toBe('ours\n')
  await expect(page.locator('.modal')).toHaveCount(0)

  box.write(repo, { 'b.txt': 'resolved by hand\n' })
  await page.locator('.file-row', { hasText: 'b.txt' }).first().click()
  await take('Take incoming file').click()
  await expect(page.locator('.modal')).toContainText('changed after git left it in conflict')
  await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click()
  expect(box.read(repo, 'b.txt')).toBe('resolved by hand\n')

  await take('Take incoming file').click()
  await page.locator('.modal .btn-danger').click()
  await expect.poll(() => box.read(repo, 'b.txt')).toBe('theirs\n')
})

/**
 * a.txt changed in two places on main and on `other`, then main merges other: two conflict blocks. `crlf`: the
 * working tree has Windows line endings (core.autocrlf).
 */
function twoConflicts(crlf = false): string {
  const file = (x: string, y: string) =>
    ['top', `x = ${x}`, 'one', 'two', 'three', 'four', 'five', `y = ${y}`, ''].join('\n')
  const repo = box.repo('game', { 'a.txt': file('1', '1') })
  if (crlf) box.git(repo, 'config', 'core.autocrlf', 'true')
  box.git(repo, 'checkout', '-qb', 'other')
  box.write(repo, { 'a.txt': file('2', '2') })
  box.git(repo, 'commit', '-qam', 'theirs')
  box.git(repo, 'checkout', '-q', 'main')
  box.write(repo, { 'a.txt': file('3', '3') })
  box.git(repo, 'commit', '-qam', 'ours')
  try {
    box.git(repo, 'merge', 'other')
  } catch {
    // stops for the conflicts
  }
  return repo
}

test('edits a conflicted file by hand, anywhere in it, starting from the blocks chosen', async () => {
  const repo = twoConflicts()
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  await page.locator('.file-row', { hasText: 'a.txt' }).first().click()
  await expect(page.locator('.conflict-block')).toHaveCount(2)
  await page.locator('.conflict-block').first().getByRole('button', { name: 'Use current' }).click()

  await page.getByRole('button', { name: 'Edit by hand' }).click()
  const editor = page.locator('.conflict-editor textarea')
  // The first block as chosen, the second one still marked.
  await expect(editor).toHaveValue(/^top\nx = 3\none\n[\s\S]*<<<<<<< HEAD\ny = 3\n=======\ny = 2\n>>>>>>> other\n$/)
  const mine = ['top', 'x = 3', 'z = 0', 'one', 'two', 'three', 'four', 'five', 'y = 2', ''].join('\n')
  await editor.fill(mine)
  await page.getByRole('button', { name: 'Save and mark resolved' }).click()

  await expect.poll(() => box.read(repo, 'a.txt')).toBe(mine)
  await expect.poll(() => box.git(repo, 'diff', '--name-only', '--diff-filter=U')).toBe('')
})

test('keeps the Windows line endings of a conflicted file edited by hand', async () => {
  const repo = twoConflicts(true)
  expect(box.read(repo, 'a.txt')).toContain('\r\n')
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  await page.locator('.file-row', { hasText: 'a.txt' }).first().click()
  await page.locator('.conflict-block').first().getByRole('button', { name: 'Use current' }).click()
  await page.locator('.conflict-block').nth(1).getByRole('button', { name: 'Use incoming' }).click()
  await page.getByRole('button', { name: 'Edit by hand' }).click()
  const editor = page.locator('.conflict-editor textarea')
  await editor.press('Control+Home')
  await editor.pressSequentially('// note\n')
  await page.getByRole('button', { name: 'Save and mark resolved' }).click()

  const crlf = ['// note', 'top', 'x = 3', 'one', 'two', 'three', 'four', 'five', 'y = 2', ''].join('\r\n')
  await expect.poll(() => box.read(repo, 'a.txt')).toBe(crlf)
})

test('asks before saving a file edited by hand that still has conflict markers, or dropping the edits', async () => {
  const repo = twoConflicts()
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  await page.locator('.file-row', { hasText: 'a.txt' }).first().click()
  await page.getByRole('button', { name: 'Edit by hand' }).click()
  const editor = page.locator('.conflict-editor textarea')
  await editor.press('Control+Home')
  await editor.pressSequentially('// note\n')

  await page.getByRole('button', { name: 'Save and mark resolved' }).click()
  await expect(page.locator('.modal')).toContainText('still has 2 conflicts')
  await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click()
  await expect(editor).toHaveValue(/^\/\/ note\ntop\n/)
  expect(box.read(repo, 'a.txt')).toContain('<<<<<<<')

  await page.getByRole('button', { name: 'Back to blocks' }).click()
  await expect(page.locator('.modal')).toContainText('changes you made by hand')
  await page.locator('.modal .btn-danger').click()
  await expect(page.locator('.conflict-block')).toHaveCount(2)
})

test('asks before a dropped branch switches to another one to merge into it', async () => {
  const repo = box.repo('game', { 'a.txt': 'base\n' })
  box.git(repo, 'branch', 'target')
  box.git(repo, 'checkout', '-qb', 'feature')
  box.write(repo, { 'b.txt': 'feature\n' })
  box.git(repo, 'add', '.')
  box.git(repo, 'commit', '-qm', 'feature work')
  box.git(repo, 'checkout', '-q', 'main')
  box.write(repo, { 'a.txt': 'mine, not committed\n' })
  await open(repo)

  const branch = (name: string) => page.locator('.side-row', { has: page.locator('.side-name', { hasText: name }) })
  const dropFeatureOnTarget = async () => {
    await branch('feature').dragTo(branch('target'))
    await menuItem('Checkout target and merge feature into it').click()
  }
  await dropFeatureOnTarget()
  const dialog = page.locator('.modal')
  await expect(dialog).toContainText('You are on main')
  await expect(dialog).toContainText('go along to target')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(box.branch(repo)).toBe('main')

  await dropFeatureOnTarget()
  await dialog.getByRole('button', { name: 'Checkout and merge' }).click()
  await expect.poll(() => box.branch(repo)).toBe('target')
  await expect.poll(() => box.git(repo, 'log', '--format=%s', '-1')).toBe('feature work')
  expect(box.read(repo, 'a.txt')).toBe('mine, not committed\n')
})

test('shows who the commit will be by, and picks another identity for the repository', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.write(repo, { 'a.txt': 'two\n' })
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  const who = page.locator('.commit-identity')
  // The sandbox's global identity.
  await expect(who).toContainText('E2E <e2e@example.invalid>')

  await who.click()
  await menuItem('Another identity…').click()
  await page.getByLabel('Name').fill('Ana Work')
  await page.getByLabel('Email').fill('ana@studio.example')
  await page.locator('.modal .btn-primary').click()
  await expect(who).toContainText('Ana Work <ana@studio.example>')
  expect(box.git(repo, 'config', '--local', 'user.email')).toBe('ana@studio.example')

  await page.getByRole('button', { name: 'Stage all changes' }).click()
  await page.locator('.summary-input').fill('by ana')
  await page.locator('.btn-commit').click()
  await expect.poll(() => box.git(repo, 'log', '-1', '--format=%an <%ae>')).toBe('Ana Work <ana@studio.example>')

  // The commit box is there again with something new to commit.
  box.write(repo, { 'a.txt': 'three\n' })
  await page.locator('.graph-row.row-wip').click()
  await who.click()
  await menuItem('Use the global identity').click()
  await expect(who).toContainText('E2E <e2e@example.invalid>')
  // The identity typed stays in the menu, to pick again.
  await who.click()
  await expect(menuItem('Ana Work <ana@studio.example>')).toBeVisible()
})

test("starts each commit message from git's commit.template", async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n', '.gitmessage': 'feat: \n\n# Say why, not what.\nWhy:\n' })
  box.git(repo, 'config', 'commit.template', '.gitmessage')
  box.write(repo, { 'a.txt': 'two\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  const summary = page.locator('.summary-input')
  const description = page.locator('.description-input')
  await expect(summary).toHaveValue('feat: ')
  await expect(description).toHaveValue('Why:')
  await page.getByRole('button', { name: 'Stage all changes' }).click()
  // Like git, the template as it is is not a message.
  await expect(page.locator('.btn-commit')).toBeDisabled()
  await expect(page.locator('.btn-commit')).toHaveText('Write the message from the template')
  await summary.fill('feat: two')
  await description.fill('Why: to have two')
  await page.locator('.btn-commit').click()
  await expect.poll(() => box.git(repo, 'log', '-1', '--format=%B')).toBe('feat: two\n\nWhy: to have two')

  // The next commit starts from the template again.
  box.write(repo, { 'a.txt': 'three\n' })
  await page.locator('.graph-row.row-wip').click()
  await expect(summary).toHaveValue('feat: ')
  // Amending from the template alone takes the last commit's message, as from an empty box.
  await page.locator('.commit-box input[type=checkbox]').first().click()
  await expect(summary).toHaveValue('feat: two')
  await expect(description).toHaveValue('Why: to have two')
})

test("hides the graph's author, date or SHA column, and keeps it hidden for the next start", async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)
  const header = page.locator('.graph-header')
  await expect(header).toContainText('AUTHOR')
  await expect(commitRows().first().locator('.cell')).toHaveCount(6)

  await header.click({ button: 'right' })
  await menuItem('✓ Author').click()
  await expect(header).not.toContainText('AUTHOR')
  await expect(commitRows().first().locator('.cell')).toHaveCount(5)
  // Shown again from the same menu, unticked.
  await header.click({ button: 'right' })
  await expect(menuItem('Author')).toBeVisible()
  await page.keyboard.press('Escape')

  await app!.close()
  ;({ app, page } = await launch(box, [repo]))
  await expect(page.locator('.graph-header')).not.toContainText('AUTHOR')
  await expect(page.locator('.graph-header')).toContainText('SHA')
})

test("moves the graph's author, date and SHA columns by dragging their headers, and keeps the order", async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)
  const headers = page.locator('.graph-header > div')
  const heading = (name: string) => headers.filter({ hasText: name })
  await expect(headers).toHaveText(['BRANCH / TAG', 'GRAPH', 'COMMIT MESSAGE', 'AUTHOR', 'DATE / TIME', 'SHA'])

  // Onto the left half of AUTHOR: before it.
  await dragByMouse(heading('SHA').locator('.col-label'), heading('AUTHOR'), { x: 5, y: 5 }, heading('SHA'))
  await expect(headers).toHaveText(['BRANCH / TAG', 'GRAPH', 'COMMIT MESSAGE', 'SHA', 'AUTHOR', 'DATE / TIME'])
  // The rows follow the header.
  await expect(commitRows().first().locator('.cell').nth(3)).toHaveClass(/sha-cell/)

  await app!.close()
  ;({ app, page } = await launch(box, [repo]))
  await expect(page.locator('.graph-header > div')).toHaveText([
    'BRANCH / TAG',
    'GRAPH',
    'COMMIT MESSAGE',
    'SHA',
    'AUTHOR',
    'DATE / TIME'
  ])
})

test('keeps the graph in view in a narrow window, by narrowing the side panels', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  ;({ app, page } = await launch(box, [repo], { leftPanelWidth: 520, rightPanelWidth: 640 }))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 920, height: 700 }))
  await expect.poll(async () => (await page.locator('.center-panel').boundingBox())?.width ?? 0).toBeGreaterThan(390)
  // The toolbar keeps its parts apart: the repository and branch end before the buttons start.
  const repoBox = (await page.locator('.toolbar-repo').boundingBox())!
  const buttons = (await page.locator('.toolbar-actions').boundingBox())!
  expect(repoBox.x + repoBox.width).toBeLessThanOrEqual(buttons.x)
  const field = page.locator('.toolbar-repo .toolbar-field').first()
  expect(await field.evaluate((el) => el.getBoundingClientRect().right)).toBeLessThanOrEqual(buttons.x)
  // Wider again, the panels are as they were left.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1800, height: 900 }))
  await expect.poll(async () => Math.round((await page.locator('.right-panel').boundingBox())?.width ?? 0)).toBe(640)
})

test("resizes the graph's author, date and SHA columns, and scrolls sideways when they do not fit", async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)
  // Wide: every column gets the width it is given.
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1800, height: 900 }))
  const sha = page.locator('.graph-header > div', { hasText: 'SHA' })
  await expect.poll(async () => Math.round((await sha.boundingBox())!.width)).toBe(70)
  const before = (await sha.boundingBox())!
  const edge = sha.locator('.col-resizer')
  const grip = (await edge.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await sha.boundingBox())!.width)).toBe(Math.round(before.width) + 60)
  // Resizing is not moving: the columns are where they were.
  await expect(page.locator('.graph-header > div')).toHaveText([
    'BRANCH / TAG',
    'GRAPH',
    'COMMIT MESSAGE',
    'AUTHOR',
    'DATE / TIME',
    'SHA'
  ])

  // Narrow, the graph scrolls sideways, the header with it, to the columns that do not fit.
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 920, height: 700 }))
  const scroller = page.locator('.graph-scroll')
  await expect.poll(() => scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  const center = (await page.locator('.center-panel').boundingBox())!
  await expect
    .poll(async () => (await sha.boundingBox())!.x + (await sha.boundingBox())!.width)
    .toBeLessThanOrEqual(center.x + center.width + 1)
  await expect
    .poll(async () => Math.round((await commitRows().first().locator('.sha-cell').boundingBox())!.x))
    .toBe(Math.round((await sha.boundingBox())!.x))
})

test("keeps the diff's picked lines when the repository is read again and the file has not changed", async () => {
  const repo = box.repo('game', { 'a.txt': 'one\ntwo\nthree\n' })
  box.write(repo, { 'a.txt': 'one\nTWO\nthree\nfour\n' })
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'a.txt' }).click()
  const added = page.locator('.diff-line.add.selectable')
  await expect(added).toHaveCount(2)
  await added.first().locator('.gutter').click()
  await expect(page.locator('.diff-line.picked')).toHaveCount(1)

  // Coming back to the window reads the repository again (as a change on disk elsewhere would).
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  // Another file changing on disk: the open diff is read again, the same.
  box.write(repo, { 'b.txt': 'new\n' })
  await expect(unstaged().locator('.file-row')).toHaveCount(2)
  await expect(page.locator('.diff-line.picked')).toHaveCount(1)

  // The file itself changed: its lines may have moved, so nothing stays picked.
  box.write(repo, { 'a.txt': 'zero\none\nTWO\nthree\nfour\n' })
  await expect(page.locator('.diff-line.add.selectable')).toHaveCount(3)
  await expect(page.locator('.diff-line.picked')).toHaveCount(0)
})

test('stages and unstages files from the keyboard, going on to the next file', async () => {
  const repo = box.repo('game', { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' })
  box.write(repo, { 'a.txt': 'a2\n', 'b.txt': 'b2\n', 'c.txt': 'c2\n' })
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  const staged = () => page.locator('.file-section').nth(1)

  await unstaged().locator('.file-row', { hasText: 'a.txt' }).click()
  await page.keyboard.press('Space')
  await expect(staged().locator('.file-row')).toHaveText([/a\.txt/])
  // The next file is open, ready for the next key.
  await expect(unstaged().locator('.file-row.active')).toContainText('b.txt')
  await page.keyboard.press('ArrowDown')
  await expect(unstaged().locator('.file-row.active')).toContainText('c.txt')
  await page.keyboard.press('Space')
  await expect(staged().locator('.file-row')).toHaveText([/a\.txt/, /c\.txt/])

  // In the staged list, Space unstages.
  await staged().locator('.file-row', { hasText: 'a.txt' }).click()
  await page.keyboard.press('Space')
  await expect(staged().locator('.file-row')).toHaveText([/c\.txt/])
})

test('goes to a tab by its number, and lists the shortcuts with F1', async () => {
  const one = box.repo('one', { 'a.txt': 'one\n' })
  const two = box.repo('two', { 'a.txt': 'two\n' })
  await open(one, two)
  await page.keyboard.press('Control+2')
  await expect(page.locator('.tab.active')).toContainText('two')

  await page.keyboard.press('F1')
  await expect(page.locator('.settings-nav-item.active')).toHaveText('Keyboard shortcuts')
  const list = page.locator('.settings-body:visible')
  await expect(list).toContainText('Stage or unstage the files checked, or the one open')
  await expect(list).toContainText(process.platform === 'darwin' ? '⌘⇧F' : 'Ctrl+Shift+F')
})

test('checks and unchecks a range of files with Shift on their checkboxes', async () => {
  const repo = box.repo('game', { 'keep.txt': 'x\n' })
  box.write(repo, { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n', 'd.txt': 'd\n' })
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  const checkbox = (name: string) => unstaged().locator('.file-row', { hasText: name }).locator('input[type=checkbox]')
  const checked = () => unstaged().locator('.file-row input[type=checkbox]:checked')

  await checkbox('a.txt').click()
  await checkbox('d.txt').click({ modifiers: ['Shift'] })
  await expect(checked()).toHaveCount(4)
  // Unchecking c with Shift unchecks c and d (from the last one clicked).
  await checkbox('c.txt').click({ modifiers: ['Shift'] })
  await expect(checked()).toHaveCount(2)
  await expect(checkbox('a.txt')).toBeChecked()
  await expect(checkbox('b.txt')).toBeChecked()
})

test('moves the dividers with the left button only, and highlights a checked file under the mouse', async () => {
  const repo = box.repo('game', { 'a.txt': 'a\n', 'b.txt': 'b\n' })
  box.write(repo, { 'a.txt': 'A\n', 'b.txt': 'B\n' })
  box.git(repo, 'add', 'b.txt')
  await open(repo)
  await page.locator('.graph-row.row-wip').click()

  const staged = page.locator('.file-section').nth(1)
  const leftPanel = page.locator('.left-panel')
  const before = { staged: (await staged.boundingBox())!.y, left: (await leftPanel.boundingBox())!.width }
  const rightDrag = async (handle: Locator, dx: number, dy: number) => {
    const at = (await handle.boundingBox())!
    const x = at.x + at.width / 2
    const y = at.y + at.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(x + dx, y + dy, { steps: 5 })
    await page.mouse.up({ button: 'right' })
  }
  await rightDrag(page.locator('.split-handle'), 0, 120)
  await rightDrag(page.locator('.resizer').first(), 80, 0)
  expect((await staged.boundingBox())!.y).toBe(before.staged)
  expect((await leftPanel.boundingBox())!.width).toBe(before.left)

  const row = unstaged().locator('.file-row', { hasText: 'a.txt' })
  await row.locator('input[type=checkbox]').click()
  await page.mouse.move(5, 5)
  const background = () => row.evaluate((el) => getComputedStyle(el).backgroundColor)
  const resting = await background()
  await row.hover()
  await expect.poll(background).not.toBe(resting)
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

test("shows the authors' pictures only once Settings asks for them", async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.write(repo, { 'a.txt': 'two\n' })
  box.git(
    repo,
    '-c',
    'user.name=Ana',
    '-c',
    'user.email=12345+ana@users.noreply.github.com',
    'commit',
    '-qam',
    'by ana'
  )
  await open(repo)
  // Nothing leaves the machine: GitHub has a picture for its user 12345, Gravatar has none.
  await app!.evaluate(() => {
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).__pictureCalls = calls
    globalThis.fetch = (async (url: string) => {
      calls.push(url)
      const png = url.startsWith('https://avatars.githubusercontent.com/u/12345')
      return {
        ok: png,
        status: png ? 200 : 404,
        headers: { get: (name: string) => (png && name.toLowerCase() === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer
      }
    }) as unknown as typeof fetch
  })
  const calls = () => app!.evaluate(() => ((globalThis as Record<string, unknown>).__pictureCalls as string[]).length)
  const byAna = commitRows().filter({ hasText: 'by ana' })
  await expect(commitRows()).toHaveCount(2)
  await expect(byAna.locator('img.avatar')).toHaveCount(0)
  expect(await calls()).toBe(0)

  await page.locator('.toolbar-right .icon-btn').click()
  await page.getByLabel("Show the authors' pictures").check()
  await page.keyboard.press('Escape')
  await expect(byAna.locator('img.avatar')).toHaveCount(1)
  // No picture anywhere for the sandbox's author: the initials stay.
  await expect(commitRows().filter({ hasText: 'first' }).locator('img.avatar')).toHaveCount(0)
  await expect(commitRows().filter({ hasText: 'first' }).locator('.avatar')).toHaveText('E')
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
    'Keyboard shortcuts',
    'About',
    // Apart from the general ones, with the repository's name.
    'This repositorygame'
  ])
  await page.locator('.settings-body:visible select').first().selectOption('light')
  await expect.poll(async () => (await page.evaluate(() => window.leviathan.getSettings())).theme).toBe('light')
  await page.locator('.settings-nav-item', { hasText: 'Accounts' }).click()
  await expect(page.locator('.settings-body:visible')).toContainText('Sign in with GitLab')
  await page.keyboard.press('Escape')
  await expect(page.locator('.modal.settings')).toHaveCount(0)
})

test('gives a repository settings of its own from its menu, the rest following the general ones', async () => {
  const space = box.repo('space', { 'a.txt': 'one\n' })
  const other = box.repo('other', { 'a.txt': 'one\n' })
  await open(space, other)

  await page.locator('.toolbar-field', { hasText: 'Repository' }).click()
  await menuItem('Settings of this repository…').click()
  const section = page.locator('.settings-body:visible')
  await expect(section).toContainText('Settings of space')
  const fetch = section.getByLabel('Fetch remotes automatically')
  await expect(fetch.locator('option').first()).toHaveText('Same as general (Never)')
  await fetch.selectOption({ label: 'Every minute' })
  await section.getByLabel('Pull mode').selectOption({ label: 'Pull (rebase)' })
  await section.getByLabel('Commits loaded at a time').fill('500')
  await section.getByLabel('Commits loaded at a time').press('Enter')

  const saved = async () => {
    const s = await page.evaluate(() => window.leviathan.getSettings())
    return { general: [s.autoFetchMinutes, s.pullMode, s.commitLimit], own: Object.entries(s.repoSettings) }
  }
  await expect
    .poll(async () => (await saved()).own.map(([path, own]) => [path.split(/[\\/]/).pop(), own]))
    .toEqual([['space', { autoFetchMinutes: 1, pullMode: 'rebase', commitLimit: 500 }]])
  expect((await saved()).general).toEqual([0, 'ff', 2000])

  // Back to the general value: the repository no longer has one of its own.
  await fetch.selectOption({ label: 'Same as general (Never)' })
  await expect
    .poll(async () => (await saved()).own.map(([, own]) => own))
    .toEqual([{ pullMode: 'rebase', commitLimit: 500 }])
  await page.keyboard.press('Escape')

  // The Pull menu marks the repository's own mode.
  await page.locator('.tool-button', { hasText: 'Pull' }).locator('.tool-caret').click()
  await expect(page.locator('.context-menu .menu-item', { hasText: 'Pull (rebase)' })).toContainText('✓')
  await page.keyboard.press('Escape')

  // Another repository: the general settings, nothing of its own.
  await page.locator('.tab', { hasText: 'other' }).click()
  await page.locator('.toolbar-right .icon-btn').click()
  await page.locator('.settings-nav-item', { hasText: 'This repository' }).click()
  await expect(section).toContainText('Settings of other')
  await expect(section.getByLabel('Pull mode')).toHaveValue('*general')
  await expect(section.getByLabel('Commits loaded at a time')).toHaveValue('')
})

test('adds an account again with a new token: one account, with the name typed, and says it was updated', async () => {
  // Accounts need the system's secure storage, which a Linux runner without a keyring does not have.
  test.skip(process.platform === 'linux' && !!process.env.CI, 'no keyring for the account token')
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)

  await page.locator('.toolbar-right .icon-btn').click()
  await page.locator('.settings-nav-item', { hasText: 'Accounts' }).click()
  const section = page.locator('.settings-body:visible')
  // "Other": the account is who the form says, nothing to ask a server.
  const add = async (token: string, name: string) => {
    await section.getByRole('button', { name: 'Add account' }).click()
    await section.locator('.account-form select').selectOption('other')
    await section.getByPlaceholder('Host').fill('git.example.com')
    await section.getByPlaceholder('Username').fill('ana')
    await section.getByPlaceholder('Personal access token').fill(token)
    if (name) await section.getByPlaceholder('Commit name').fill(name)
    await section.getByRole('button', { name: 'Add', exact: true }).click()
  }

  await add('first-token', '')
  await expect(page.locator('.toasts')).toContainText('Account ana@git.example.com added')
  await expect(section.locator('.ssh-key')).toHaveCount(1)
  await add('second-token', 'Ana Work')
  await expect(page.locator('.toasts')).toContainText('Account ana@git.example.com updated with the new token')
  await expect(section.locator('.ssh-key')).toHaveCount(1)
  await expect(section.locator('.ssh-key')).toContainText('Ana Work <')
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
  const section = page.locator('.settings-body:visible')
  await section.locator('label.field', { hasText: 'Terminal' }).locator('select').selectOption('custom')
  const command = section.locator('label.field', { hasText: "started in the repository's folder" }).locator('input')
  await command.fill(`"${process.execPath}" "${fake}" {folder}`)
  await command.blur()
  await expect
    .poll(async () => (await page.evaluate(() => window.leviathan.getSettings())).terminal)
    .toContain('fake-terminal')
  await page.keyboard.press('Escape')

  // The button shows the terminal inside the app; a separate one is in its menu.
  await page.locator('.tool-button', { hasText: 'Terminal' }).locator('.tool-caret').click()
  await menuItem('Open in a separate window').click()
  await expect.poll(() => existsSync(marker)).toBe(true)
  const started = JSON.parse(readFileSync(marker, 'utf8')) as { cwd: string; folder: string }
  const same = (p: string) => realpathSync.native(p).toLowerCase()
  expect(same(started.cwd)).toBe(same(repo))
  expect(same(started.folder)).toBe(same(repo))
})

test('runs commands in the terminal at the bottom, each repository with its own', async () => {
  const game = box.repo('game', { 'a.txt': 'one\n' })
  const tool = box.repo('tool', { 'b.txt': 'one\n' })
  await open(game, tool)

  await toolbarButton('Terminal').click()
  const screen = page.locator('.terminal-panel .xterm-rows')
  // Its prompt names the repository's folder (PowerShell, bash and zsh alike).
  await expect(screen).toContainText('game', { timeout: 20_000 })
  await page.keyboard.type('git commit --allow-empty -m "from the terminal"')
  await page.keyboard.press('Enter')
  // The graph shows it, as with any change made outside the app.
  await expect(commitRows().first()).toContainText('from the terminal', { timeout: 20_000 })

  // Another repository has its own, not shown until asked for; back, the first one is as it was.
  await page.locator('.tab', { hasText: 'tool' }).click()
  await expect(page.locator('.terminal-panel')).toHaveCount(0)
  await page.locator('.tab', { hasText: 'game' }).click()
  await expect(screen).toContainText('from the terminal')

  // Keys typed there are the shell's; Ctrl and the key left of 1 hides it.
  await page.locator('.terminal-panel .xterm').click()
  await page.keyboard.press('Control+Backquote')
  await expect(page.locator('.terminal-panel')).toHaveCount(0)
  await expect(page.locator('.tab')).toHaveCount(2)
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

/** Commits `count` more changes of `file` onto main, in one git process. */
function commitMany(repo: string, file: string, count: number): void {
  const head = box.git(repo, 'rev-parse', 'HEAD')
  const commits = Array.from({ length: count }, (_, i) => {
    const content = `${i + 1}\n`
    return [
      'commit refs/heads/main',
      `committer E2E <e2e@example.invalid> ${1700000000 + i} +0000`,
      `data ${`change ${i + 1}`.length}`,
      `change ${i + 1}`,
      ...(i === 0 ? [`from ${head}`] : []),
      `M 100644 inline ${file}`,
      `data ${content.length}`,
      content
    ].join('\n')
  })
  execFileSync('git', ['fast-import', '--quiet'], { cwd: repo, env: box.env, input: commits.join('\n') + '\n' })
  box.git(repo, 'reset', '-q', '--hard')
}

test('says when a file history shows only its latest commits, and shows more', async () => {
  const repo = box.repo('game', { 'f.txt': '0\n' })
  commitMany(repo, 'f.txt', 300)
  box.write(repo, { 'f.txt': 'mine\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'f.txt' }).click({ button: 'right' })
  await menuItem('File history').click()
  await expect(page.locator('.history-row')).toHaveCount(300)
  await expect(page.locator('.history-more')).toContainText('Showing the latest 300 commits')
  await page.locator('.history-more').getByRole('button', { name: 'Show more' }).click()
  await expect(page.locator('.history-row')).toHaveCount(301)
  await expect(page.locator('.history-more')).toHaveCount(0)
})

test('refreshes an open file history and blame after a commit', async () => {
  const repo = box.repo('game', { 'f.txt': 'one\n' })
  box.write(repo, { 'f.txt': 'one\ntwo\n' })
  await open(repo)
  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'f.txt' }).click({ button: 'right' })
  await menuItem('Blame (who changed each line)').click()
  await expect(page.locator('.blame-line', { hasText: 'two' })).toContainText('Not committed yet')

  // Committed from the terminal: the blame shows the new commit without being opened again.
  box.git(repo, 'commit', '-qam', 'add two')
  await expect(page.locator('.blame-line', { hasText: 'two' })).not.toContainText('Not committed yet')

  await page.keyboard.press('Escape')
  box.write(repo, { 'f.txt': 'one\ntwo\nthree\n' })
  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'f.txt' }).click({ button: 'right' })
  await menuItem('File history').click()
  await expect(page.locator('.history-row')).toHaveCount(2)
  box.git(repo, 'commit', '-qam', 'add three')
  await expect(page.locator('.history-row')).toHaveCount(3)
  await expect(page.locator('.history-row').first()).toContainText('add three')
})

test('says that a commit only renamed a file', async () => {
  const repo = box.repo('game', { 'old.txt': 'same\n' })
  box.git(repo, 'mv', 'old.txt', 'new.txt')
  box.git(repo, 'commit', '-qm', 'rename it')
  box.write(repo, { 'new.txt': 'same, edited\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'new.txt' }).click({ button: 'right' })
  await menuItem('File history').click()
  await expect(page.locator('.history-row').first()).toContainText('rename it')
  await expect(page.locator('.file-view .diff-body')).toContainText('Renamed from old.txt, with no other change')
})

test('blames a line as it was before the commit that changed it, and comes back', async () => {
  const repo = box.repo('game', { 'notes.txt': 'one\ntwo\n' })
  box.write(repo, { 'notes.txt': 'one\ntwo, edited\n' })
  box.git(repo, 'commit', '-qam', 'edit two')
  box.git(repo, 'mv', 'notes.txt', 'docs.txt')
  box.git(repo, 'commit', '-qm', 'rename')
  box.write(repo, { 'docs.txt': 'one\ntwo, edited\nthree\n' })
  await open(repo)

  await page.locator('.graph-row.row-wip').click()
  await unstaged().locator('.file-row', { hasText: 'docs.txt' }).click({ button: 'right' })
  await menuItem('Blame (who changed each line)').click()
  await expect(page.locator('.blame-line')).toHaveCount(3)
  // The first commit has nothing before it.
  await page.locator('.blame-line', { hasText: 'one' }).hover()
  await expect(page.locator('.blame-line', { hasText: 'one' }).getByTitle('Blame before this change')).toHaveCount(0)

  const edited = page.locator('.blame-line', { hasText: 'two, edited' })
  await edited.hover()
  await edited.getByTitle('Blame before this change').click()
  // The file under its name then, the line as it was, shown.
  await expect(page.locator('.file-view .diff-title')).toContainText('notes.txt')
  await expect(page.locator('.blame-line.target')).toContainText('two')
  await expect(page.locator('.blame-line')).toHaveText([/one/, /two$/])

  await page.locator('.file-view').getByRole('button', { name: 'Back' }).click()
  await expect(page.locator('.file-view .diff-title')).toContainText('docs.txt')
  await expect(page.locator('.blame-line')).toHaveCount(3)
})

test('says when a blame shows only the first lines of a long file', async () => {
  const repo = box.repo('game', {
    'long.txt': Array.from({ length: 20_005 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  })
  await open(repo)

  await commitRows().filter({ hasText: 'first' }).click()
  await page.locator('.right-panel .file-row', { hasText: 'long.txt' }).click({ button: 'right' })
  await menuItem('Blame (who changed each line)').click()
  await expect(page.locator('.blame-more')).toContainText('Showing the first 20,000 lines')
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
  const target = (await row('three').boundingBox())!
  await dragByMouse(row('one').locator('.rebase-grip'), row('three'), { x: 40, y: target.height / 2 }, row('one'))
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

test("says why an interactive rebase stopped when it was not for conflicts, and goes on once that's fixed", async () => {
  const repo = threeCommits()
  // two.txt leaves the index and stays untracked: picking "two" again would overwrite it.
  box.git(repo, 'rm', '-q', '--cached', 'two.txt')
  box.git(repo, 'commit', '-qm', 'untrack two')
  await open(repo)
  await commitRows().filter({ hasText: 'first' }).click({ button: 'right' })
  await menuItem('Interactive rebase from here…').click()
  await page.locator('.rebase-row', { hasText: 'one' }).locator('select').selectOption('drop')
  await page.getByRole('button', { name: 'Start rebase' }).click()

  const toast = page.locator('.toast.error')
  await expect(toast).toContainText('untracked working tree files would be overwritten by merge')
  await expect(toast).toContainText('two.txt')
  await expect(toast).not.toContainText('git rebase')
  await expect(page.locator('.op-banner')).toBeVisible()

  rmSync(join(repo, 'two.txt'))
  await page.locator('.op-banner').getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator('.op-banner')).toHaveCount(0)
  expect(box.git(repo, 'log', '--format=%s', '-4')).toBe('untrack two\nthree\ntwo\nfirst')
})

test("says why a rebase stopped when it was not for conflicts, without git's hints", async () => {
  const repo = box.repo('game', { 'base.txt': 'base\n' })
  box.git(repo, 'checkout', '-qb', 'feature')
  box.write(repo, { 'two.txt': 'two\n' })
  box.git(repo, 'add', '.')
  box.git(repo, 'commit', '-qm', 'add two')
  // two.txt leaves the index and stays untracked: replaying "add two" would overwrite it.
  box.git(repo, 'rm', '-q', '--cached', 'two.txt')
  box.git(repo, 'commit', '-qm', 'untrack two')
  box.git(repo, 'checkout', '-q', 'main')
  box.write(repo, { 'main.txt': 'main\n' })
  box.git(repo, 'add', 'main.txt')
  box.git(repo, 'commit', '-qm', 'main work')
  box.git(repo, 'checkout', '-q', 'feature')
  await open(repo)

  await page.locator('.side-row', { has: page.locator('.side-name', { hasText: /^main$/ }) }).click({ button: 'right' })
  await menuItem('Rebase feature onto main').click()
  const toast = page.locator('.toast.error')
  await expect(toast).toContainText('untracked working tree files would be overwritten')
  await expect(toast).toContainText('two.txt')
  await expect(toast).not.toContainText('git rebase')
  await expect(toast).not.toContainText('hint:')
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

test('asks where to publish a branch started from another remote, then keeps the upstream chosen for it', async () => {
  const origin = join(box.root, 'origin.git')
  const upstream = join(box.root, 'upstream.git')
  box.git(box.root, 'init', '-q', '--bare', '-b', 'main', origin)
  box.git(box.root, 'init', '-q', '--bare', '-b', 'main', upstream)
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.git(repo, 'remote', 'add', 'origin', origin)
  box.git(repo, 'remote', 'add', 'upstream', upstream)
  box.git(repo, 'push', '-q', '-u', 'origin', 'main')
  box.git(repo, 'push', '-q', 'upstream', 'main')
  // A fork's branch started from the original repository's main: git makes upstream/main its upstream.
  box.git(repo, 'checkout', '-q', '-b', 'feature', 'upstream/main')
  box.write(repo, { 'b.txt': 'mine\n' })
  box.git(repo, 'add', '.')
  box.git(repo, 'commit', '-qm', 'mine')
  box.write(repo, { 'c.txt': 'more\n' })
  await open(repo)

  await toolbarButton('Push').click()
  await expect(page.locator('.modal')).toContainText('Publish feature to')
  await page.locator('.modal .btn-primary').click()
  // Until the push sets it, git fails to name an upstream: poll for an answer, not an error.
  const upstreamOf = () =>
    spawnSync('git', ['rev-parse', '--abbrev-ref', 'feature@{upstream}'], { cwd: repo, encoding: 'utf8' }).stdout.trim()
  await expect.poll(upstreamOf).toBe('origin/feature')
  expect(box.git(origin, 'rev-parse', 'feature')).toBe(box.git(repo, 'rev-parse', 'feature'))
  expect(spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/heads/feature'], { cwd: upstream }).status).not.toBe(0)

  // Following the original main on purpose from now on.
  box.git(repo, 'branch', '-q', '--set-upstream-to=upstream/main')
  await page.locator('.graph-row.row-wip').click()
  await page.getByRole('button', { name: 'Stage all changes' }).click()
  await page.locator('.summary-input').fill('more')
  await page.locator('.btn-commit').click()
  await expect(commitRows().first()).toContainText('more')
  await toolbarButton('Push').click()

  await expect.poll(() => box.git(origin, 'log', '-1', '--format=%s', 'feature')).toBe('more')
  await expect(page.locator('.modal')).toHaveCount(0)
  expect(box.git(repo, 'rev-parse', '--abbrev-ref', 'feature@{upstream}')).toBe('upstream/main')
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
  // The toast says how it went: on failure, its text is the reason.
  await expect(page.locator('.toasts')).toContainText('SSH key created', { timeout: 30_000 })

  const key = join(home, '.ssh', 'id_ed25519')
  expect(existsSync(`${key}.pub`)).toBe(true)
  const opens = (given: string) =>
    spawnSync('ssh-keygen', ['-y', '-P', given, '-f', key], { stdio: 'ignore' }).status === 0
  expect(opens('')).toBe(false)
  expect(opens(passphrase)).toBe(true)
  await expect(page.locator('.toast.error')).toHaveCount(0)
})

test('asks once to install git-lfs for a repository that uses it, and offers it in the LFS section', async () => {
  // git for Windows ships git-lfs next to git: the app is told to act as if it were missing.
  box.env.LEVIATHAN_E2E_NO_GIT_LFS = '1'
  const game = box.repo('game', { '.gitattributes': '*.psd filter=lfs diff=lfs merge=lfs -text\n', 'a.txt': 'one\n' })
  const tool = box.repo('tool', { 'a.txt': 'one\n' })
  await open(game, tool)

  const modal = page.locator('.modal')
  await expect(modal).toContainText('Git LFS is not installed')
  await expect(modal).toContainText('game keeps its large files')
  await modal.getByRole('button', { name: 'Cancel' }).click()
  await expect(modal).toHaveCount(0)

  // Once per repository and session: coming back to it does not ask again.
  await page.locator('.tab', { hasText: 'tool' }).click()
  await page.locator('.tab', { hasText: 'game' }).click()
  await expect(page.locator('.left-panel')).toContainText('git-lfs is not installed')
  await expect(modal).toHaveCount(0)

  const lfs = page.locator('.left-panel .side-link')
  await expect(lfs.filter({ hasText: 'Get Git LFS' })).toHaveCount(1)
  // Windows always installs from the app; what Linux and macOS offer depends on the machine.
  if (process.platform === 'win32') await expect(lfs.filter({ hasText: 'Install git-lfs' })).toHaveCount(1)
})
