# Fixup into an older commit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a commit's context menu, add what is staged to that commit (any commit of the current branch), with git's own `commit --fixup` and `rebase -i --autosquash --autostash`, undoable in one step.

**Architecture:** A new main-process module `src/main/git/fixup.ts` checks (`fixupInfo`) and runs (`fixupCommit`) the fixup; `abortOperation` in `repository.ts` soft-resets the fixup commit away when a stopped fixup is aborted (a mark file inside git's `rebase-merge` folder). The renderer adds `fixupInto` (confirm for published commits, signing fallback, toast, selection) and a menu item; undo records it `soft` and leaves the stash list out.

**Tech Stack:** Electron + TypeScript, React renderer (zustand store), vitest (integration tests against real git repos), Playwright e2e against the built app.

Spec: `docs/superpowers/specs/2026-11-14-fixup-older-commit-design.md`.

## Global Constraints

- Branch `feat/fixup-older-commit`. Commit messages: conventional (`feat:`, `test:`, `docs:`), **no `Co-Authored-By` or any Claude attribution line**.
- Code comments and docs in the project's style: plain English, says what and why, no "we".
- Every user-visible string goes through i18n with both `en.ts` and `es.ts` (es is typed `Record<keyof typeof en, string>`; plural variant `<key>_one` when `count === 1`).
- Run vitest from PowerShell after `Set-Location D:\REPOS\Leviathan` (a lowercase `d:` cwd makes vitest fail to find its runner).
- Git behaviour checked by hand on git 2.53 (2026-11-14): a refusing `pre-rebase` hook gives the autostash back and leaves no rebase; `rebase --abort` returns to the fixup commit and git deletes `rebase-merge/` (and a file put in it); a commit with an empty subject makes autosquash match nothing (the fixup commit stays a commit of its own).

## File Structure

- Create `src/shared/fixup.ts` — `FixupRefusal`, `FixupInfo`, `pendingFixup()` (pure).
- Create `src/main/git/fixup.ts` — `fixupInfo()`, `fixupCommit()`.
- Modify `src/main/git/repository.ts` — export `run`, `gitDir`, `currentOperation`, `assertSafeArg`; add `FIXUP_MARK`, `stoppedFixup()`; `abortOperation` repairs an aborted fixup.
- Modify `src/shared/undo.ts` — `leavingStashes()`.
- Modify `src/renderer/src/undoStack.ts` — `StoppedAction.stashes`.
- Modify `src/renderer/src/actions.ts` — `recordUndo`/`runOp`/`settleStoppedAction` stash option; `signingQuiet`/`commitUnsigned` helpers (used by `commit` and `fixupInto`); `fixupInto`.
- Modify `src/shared/api.ts`, `src/main/ipc.ts` — the two IPC methods.
- Modify `src/renderer/src/menus.ts` — the menu item.
- Modify `src/renderer/src/i18n/en.ts`, `es.ts` — strings.
- Create `tests/fixup.test.ts`; modify `tests/undo.test.ts`, `e2e/app.spec.ts`.
- Modify `CHANGELOG.md`, `docs/STATUS.md`.

---

### Task 1: `fixupInfo` — the check on click

**Files:**
- Create: `src/shared/fixup.ts`
- Create: `src/main/git/fixup.ts`
- Modify: `src/main/git/repository.ts` (helpers at lines ~86, ~100, ~168, ~177 become exported)
- Test: `tests/fixup.test.ts`

**Interfaces:**
- Produces: `type FixupRefusal = 'operation' | 'nothingStaged' | 'notAncestor' | 'merges' | 'pendingFixups'`; `type FixupInfo = { ok: true; subject: string; published: number } | { ok: false; reason: FixupRefusal }`; `pendingFixup(subjects: string[]): boolean`; `fixupInfo(repo: string, target: string): Promise<FixupInfo>`; internal `planFixup(repo, target): Promise<FixupPlan | FixupRefusal>` with `FixupPlan = { target: string; subject: string; range: string[]; base: string | null }`; `count(repo, revs): Promise<number>`.
- Exported from `repository.ts`: `run(repo, args, extra?)`, `gitDir(repo)`, `currentOperation(repo)`, `assertSafeArg(value, what)`.

- [ ] **Step 1: Write the failing tests** — create `tests/fixup.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixupInfo } from '../src/main/git/fixup'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { pendingFixup } from '../src/shared/fixup'

let dir: string
const hashes: Record<string, string> = {}

const out = async (...args: string[]) => (await git(args, { cwd: dir })).stdout.trim()
const head = () => out('rev-parse', 'HEAD')
const subjects = async () => (await out('log', '--format=%s')).split('\n')
const staged = () => out('diff', '--cached', '--name-only')

async function commitFile(name: string, content: string, message: string): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return head()
}

async function stageFile(name: string, content: string): Promise<void> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
}

/** A hook that says no (git runs hooks through its own sh, on Windows too), in a folder of the test's own. */
async function failingHook(name: string): Promise<void> {
  const hooks = join(dir, '..', 'hooks')
  mkdirSync(hooks, { recursive: true })
  writeFileSync(join(hooks, name), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  await git(['config', 'core.hooksPath', hooks.replace(/\\/g, '/')], { cwd: dir })
}

/** A repository with commits base, one, two, three, each adding `<name>.txt`. */
beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-fixup-')), 'repo'), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: dir })
  hashes.base = await commitFile('base.txt', 'base\n', 'base')
  for (const name of ['one', 'two', 'three']) hashes[name] = await commitFile(`${name}.txt`, `${name}\n`, name)
})

afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('pendingFixup', () => {
  it('finds the subjects that autosquash melds into another commit', () => {
    expect(pendingFixup(['two', 'fixup! one'])).toBe(true)
    expect(pendingFixup(['squash! one'])).toBe(true)
    expect(pendingFixup(['amend! one'])).toBe(true)
    expect(pendingFixup(['one', 'fixup one', 'a fixup! here'])).toBe(false)
  })
})

describe('fixupInfo', () => {
  it('gives the subject of the commit, with nothing published without a remote', async () => {
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: true, subject: 'one', published: 0 })
  })

  it('counts the commits to rewrite that are already on a remote', async () => {
    const origin = join(dir, '..', 'origin.git')
    await git(['init', '-q', '--bare', origin], { cwd: join(dir, '..') })
    await git(['remote', 'add', 'origin', origin], { cwd: dir })
    await git(['push', '-q', 'origin', `${hashes.two}:refs/heads/main`], { cwd: dir })
    await git(['fetch', '-q', 'origin'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    // one, two and three are rewritten; one and two are on origin.
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: true, subject: 'one', published: 2 })
    expect(await fixupInfo(dir, hashes.three)).toEqual({ ok: true, subject: 'three', published: 0 })
  })

  it('refuses when nothing is staged', async () => {
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'nothingStaged' })
  })

  it('refuses a commit that is not on the current branch', async () => {
    await git(['checkout', '-q', '-b', 'side', hashes.base], { cwd: dir })
    const side = await commitFile('side.txt', 'side\n', 'side')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, side)).toEqual({ ok: false, reason: 'notAncestor' })
    expect(await fixupInfo(dir, 'no-such-commit')).toEqual({ ok: false, reason: 'notAncestor' })
  })

  it('refuses when a merge comes after the commit, not once past it', async () => {
    await git(['checkout', '-q', '-b', 'side', hashes.one], { cwd: dir })
    await commitFile('side.txt', 'side\n', 'side')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    await git(['merge', '-q', '--no-ff', '-m', 'merge side', 'side'], { cwd: dir })
    const four = await commitFile('four.txt', 'four\n', 'four')
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'merges' })
    expect(await fixupInfo(dir, four)).toEqual({ ok: true, subject: 'four', published: 0 })
  })

  it('refuses when fixup or squash commits wait after the commit', async () => {
    await commitFile('two.txt', 'two\nlater\n', 'fixup! two')
    await stageFile('one.txt', 'one\nmore\n')
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'pendingFixups' })
  })

  it('refuses while an operation or a bisect is under way', async () => {
    await git(['checkout', '-q', '-b', 'side', hashes.base], { cwd: dir })
    const side = await commitFile('one.txt', 'side\n', 'side')
    await git(['checkout', '-q', 'main'], { cwd: dir })
    await git(['cherry-pick', side], { cwd: dir, okCodes: [0, 1] })
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'operation' })
    await git(['cherry-pick', '--abort'], { cwd: dir })
    await git(['bisect', 'start', 'HEAD', hashes.base], { cwd: dir })
    expect(await fixupInfo(dir, hashes.one)).toEqual({ ok: false, reason: 'operation' })
  })
})
```

(`readFileSync`, `subjects`, `staged` and `failingHook` are used by the tests Tasks 2 and 3 add to this file.)

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/fixup.test.ts`
Expected: FAIL — cannot resolve `../src/main/git/fixup` / `../src/shared/fixup`.

- [ ] **Step 3: Create `src/shared/fixup.ts`**

```ts
/** Why the staged changes cannot be added to a commit now. */
export type FixupRefusal = 'operation' | 'nothingStaged' | 'notAncestor' | 'merges' | 'pendingFixups'

/** Whether the staged changes can go into a commit: its subject, and how many of the commits rewritten are on a remote. */
export type FixupInfo = { ok: true; subject: string; published: number } | { ok: false; reason: FixupRefusal }

/** Subjects that git's autosquash melds into an earlier commit. */
const MELDED = /^(fixup|squash|amend)! /

/** Whether one of `subjects` is a commit autosquash would meld too (and a `squash!` would change a message). */
export function pendingFixup(subjects: string[]): boolean {
  return subjects.some((s) => MELDED.test(s))
}
```

- [ ] **Step 4: Export the helpers `fixup.ts` needs from `src/main/git/repository.ts`**

Change these four declarations (only `export` is added):

```ts
export async function run(repo: string, args: string[], extra: Partial<Parameters<typeof git>[1]> = {}): Promise<string> {
```
```ts
export function assertSafeArg(value: string, what: string): void {
```
```ts
export async function gitDir(repo: string): Promise<string> {
```
```ts
export async function currentOperation(repo: string): Promise<RepoOperation> {
```

- [ ] **Step 5: Create `src/main/git/fixup.ts`**

```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pendingFixup, type FixupInfo, type FixupRefusal } from '../../shared/fixup'
import { assertSafeArg, currentOperation, gitDir, run } from './repository'
import { git } from './runner'

/** What a fixup into a commit rewrites. */
interface FixupPlan {
  /** The commit, as a full hash. */
  target: string
  subject: string
  /** What `rev-list` walks for the commits rewritten: from the commit before `target` (all of HEAD for a root). */
  range: string[]
  /** The commit before `target`; null for a root commit. */
  base: string | null
}

async function count(repo: string, revs: string[]): Promise<number> {
  return Number((await run(repo, ['rev-list', '--count', ...revs, '--'])).trim())
}

/** What adding the staged changes to `target` rewrites, or why it cannot be done now. */
async function planFixup(repo: string, target: string): Promise<FixupPlan | FixupRefusal> {
  assertSafeArg(target, 'commit')
  // A bisect has HEAD on a commit to test: rewriting the branch under it would lose its way.
  if ((await currentOperation(repo)) || existsSync(join(await gitDir(repo), 'BISECT_START'))) return 'operation'
  if ((await git(['diff', '--cached', '--quiet'], { cwd: repo, okCodes: [0, 1] })).exitCode === 0) return 'nothingStaged'
  const found = await git(['rev-parse', '--verify', '--quiet', `${target}^{commit}`], { cwd: repo, okCodes: [0, 1] })
  const hash = found.stdout.trim()
  if (!hash) return 'notAncestor'
  const ancestor = await git(['merge-base', '--is-ancestor', hash, 'HEAD'], { cwd: repo, okCodes: [0, 1] })
  if (ancestor.exitCode !== 0) return 'notAncestor'
  const [, base = null] = (await run(repo, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ')
  const range = base ? [`${base}..HEAD`] : ['HEAD']
  if ((await run(repo, ['rev-list', '--merges', ...range, '--'])).trim()) return 'merges'
  // Autosquash would meld those as well, into their own targets.
  if (pendingFixup((await run(repo, ['log', '--format=%s', ...range, '--'])).split('\n'))) return 'pendingFixups'
  const subject = (await run(repo, ['log', '-1', '--format=%s', hash, '--'])).trim()
  return { target: hash, subject, range, base }
}

/**
 * Whether what is staged can be added to `target` now. `published`: how many of the commits rewritten (`target` and
 * those after it) are on a remote, which pushing them again then needs Force push for. `RepoState.unpushed` does not
 * tell: it stops at 500 commits and is empty without remotes.
 */
export async function fixupInfo(repo: string, target: string): Promise<FixupInfo> {
  const plan = await planFixup(repo, target)
  if (typeof plan === 'string') return { ok: false, reason: plan }
  const published = (await count(repo, plan.range)) - (await count(repo, [...plan.range, '--not', '--remotes']))
  return { ok: true, subject: plan.subject, published }
}
```

- [ ] **Step 6: Run the tests**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/fixup.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add src/shared/fixup.ts src/main/git/fixup.ts src/main/git/repository.ts tests/fixup.test.ts
git commit -m "feat: check whether staged changes can go into an older commit"
```

---

### Task 2: `fixupCommit` — commit, autosquash rebase, safety nets

**Files:**
- Modify: `src/main/git/fixup.ts`
- Modify: `src/main/git/repository.ts` (add `FIXUP_MARK` next to `abortOperation`, ~line 1090)
- Test: `tests/fixup.test.ts`

**Interfaces:**
- Consumes: `planFixup`, `count` (Task 1); `run`, `gitDir`, `currentOperation` from `repository.ts`.
- Produces: `fixupCommit(repo: string, target: string, noSign?: boolean): Promise<{ hash: string }>` (the rewritten target); `FIXUP_MARK = 'leviathan-fixup'` exported from `repository.ts` (file name inside `<gitdir>/rebase-merge/`, content: the fixup commit's hash + `\n`).

- [ ] **Step 1: Write the failing tests** — in `tests/fixup.test.ts`, change the import to `import { fixupCommit, fixupInfo } from '../src/main/git/fixup'` and append:

```ts
describe('fixupCommit', () => {
  it('adds the staged changes to an older commit, leaving the later ones and every message as they were', async () => {
    await stageFile('one.txt', 'one\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.one)
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
    expect(hash).toBe(await out('rev-parse', 'HEAD~2'))
    expect(await out('show', `${hash}:one.txt`)).toBe('one\nmore')
    expect(await out('diff', '--name-only', hashes.three, 'HEAD')).toBe('one.txt')
    expect(await out('status', '--porcelain')).toBe('')
    expect((await repo.getState(dir)).operation).toBeNull()
  })

  it('leaves unstaged changes and untracked files where they were', async () => {
    await stageFile('one.txt', 'one\nmore\n')
    writeFileSync(join(dir, 'two.txt'), 'two\nlocal\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    await fixupCommit(dir, hashes.one)
    expect(readFileSync(join(dir, 'two.txt'), 'utf8')).toBe('two\nlocal\n')
    expect(readFileSync(join(dir, 'new.txt'), 'utf8')).toBe('new\n')
    expect(await staged()).toBe('')
    expect(await out('diff', '--name-only')).toBe('two.txt')
    expect(await out('stash', 'list')).toBe('')
  })

  it('adds them to the root commit', async () => {
    await stageFile('base.txt', 'base\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.base)
    expect(hash).toBe(await out('rev-list', '--max-parents=0', 'HEAD'))
    expect(await out('show', `${hash}:base.txt`)).toBe('base\nmore')
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
  })

  it('adds them to the commit checked out', async () => {
    await stageFile('three.txt', 'three\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.three)
    expect(hash).toBe(await head())
    expect(await out('show', 'HEAD:three.txt')).toBe('three\nmore')
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
  })

  it('adds them to the older of two commits with the same subject', async () => {
    await commitFile('four.txt', 'four\n', 'one')
    await stageFile('one.txt', 'one\nmore\n')
    const { hash } = await fixupCommit(dir, hashes.one)
    expect(hash).toBe(await out('rev-parse', 'HEAD~3'))
    expect(await out('show', `${hash}:one.txt`)).toBe('one\nmore')
    expect(await out('diff', '--name-only', 'HEAD~1', 'HEAD')).toBe('four.txt')
  })

  it('changes nothing when it is refused', async () => {
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow('Nothing is staged.')
    expect(await head()).toBe(before)
  })

  it('changes nothing when a commit hook says no', async () => {
    await failingHook('pre-commit')
    await stageFile('one.txt', 'one\nmore\n')
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow()
    expect(await head()).toBe(before)
    expect(await staged()).toBe('one.txt')
  })

  it('stages the changes again when the rebase does not start', async () => {
    await failingHook('pre-rebase')
    await stageFile('one.txt', 'one\nmore\n')
    writeFileSync(join(dir, 'two.txt'), 'two\nlocal\n')
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow(/pre-rebase/)
    expect(await head()).toBe(before)
    expect(await staged()).toBe('one.txt')
    expect(readFileSync(join(dir, 'two.txt'), 'utf8')).toBe('two\nlocal\n')
    expect((await repo.getState(dir)).operation).toBeNull()
  })

  it('is not held up by a sequence editor in the config', async () => {
    await git(['config', 'sequence.editor', 'false'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    await fixupCommit(dir, hashes.one)
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
  })

  it('puts everything back when git cannot tell which commit the changes are for', async () => {
    // A commit without a message: "fixup! " matches nothing, and git keeps the fixup commit as one of its own.
    writeFileSync(join(dir, 'four.txt'), 'four\n')
    await repo.stage(dir, ['four.txt'])
    await git(['commit', '-q', '--allow-empty-message', '-m', ''], { cwd: dir })
    const empty = await head()
    await commitFile('five.txt', 'five\n', 'five')
    await stageFile('four.txt', 'four\nmore\n')
    const before = await head()
    await expect(fixupCommit(dir, empty)).rejects.toThrow('git could not add the changes to that commit.')
    expect(await head()).toBe(before)
    expect(await staged()).toBe('four.txt')
    expect(await out('diff', '--cached')).toContain('+more')
  })

  it('signs nothing when told not to, after signing failed', async () => {
    await git(['config', 'commit.gpgsign', 'true'], { cwd: dir })
    await git(['config', 'gpg.program', 'leviathan-no-such-gpg'], { cwd: dir })
    await stageFile('one.txt', 'one\nmore\n')
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow(/gpg failed to sign/)
    expect(await head()).toBe(before)
    expect(await staged()).toBe('one.txt')
    await fixupCommit(dir, hashes.one, true)
    expect(await subjects()).toEqual(['three', 'two', 'one', 'base'])
    expect(await out('show', 'HEAD~2:one.txt')).toBe('one\nmore')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/fixup.test.ts`
Expected: FAIL — `fixupCommit` is not exported.

- [ ] **Step 3: Add `FIXUP_MARK` to `src/main/git/repository.ts`**, right above `export async function abortOperation`:

```ts
/** The file in git's `rebase-merge` folder that marks the rebase as a fixup's (`fixupCommit`): the fixup commit. */
export const FIXUP_MARK = 'leviathan-fixup'
```

- [ ] **Step 4: Add `fixupCommit` to `src/main/git/fixup.ts`**

Change the imports to:

```ts
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pendingFixup, type FixupInfo, type FixupRefusal } from '../../shared/fixup'
import { FIXUP_MARK, assertSafeArg, currentOperation, gitDir, run } from './repository'
import { git } from './runner'
```

and append:

```ts
/** Why `fixupCommit` refuses (the renderer words its own, translated, from `fixupInfo`). */
const REFUSED: Record<FixupRefusal, string> = {
  operation: 'Finish or abort what is under way first.',
  nothingStaged: 'Nothing is staged.',
  notAncestor: 'That commit is not on the current branch.',
  merges: 'There are merges after that commit.',
  pendingFixups: 'There are fixup or squash commits after that commit.'
}

/**
 * Adds what is staged to `target`, a commit of the current branch, rewriting those after it: git's `commit --fixup`,
 * then `rebase -i --autosquash --autostash`, which sets the unstaged changes aside and brings them back. Gives the
 * commit `target` became. Stops, like any rebase, at a commit that does not apply cleanly; aborting it then leaves
 * everything as before (`abortOperation`). `noSign`: neither the fixup commit nor the rewritten ones are signed.
 */
export async function fixupCommit(repo: string, target: string, noSign = false): Promise<{ hash: string }> {
  const plan = await planFixup(repo, target)
  if (typeof plan === 'string') throw new Error(REFUSED[plan])
  const head = async () => (await run(repo, ['rev-parse', 'HEAD'])).trim()
  const before = await head()
  const after = await count(repo, [`${plan.target}..HEAD`])
  const sign = noSign ? ['--no-gpg-sign'] : []
  // Through the user's hooks and signing, as any commit; failing, it has changed nothing.
  await run(repo, ['commit', '-q', ...sign, `--fixup=${plan.target}`])
  const fixup = await head()
  try {
    await run(repo, ['rebase', '-i', '--autosquash', '--autostash', ...sign, ...(plan.base ? [plan.base] : ['--root'])], {
      // Over a `sequence.editor` of the user's, which would win over GIT_EDITOR: git's own list, as it is.
      env: { GIT_SEQUENCE_EDITOR: 'true' }
    })
  } catch (err) {
    if (await currentOperation(repo)) {
      // Stopped part way. Git deletes its folder, and the mark with it, once the rebase is over however it ends.
      await fs.writeFile(join(await gitDir(repo), 'rebase-merge', FIXUP_MARK), `${fixup}\n`).catch(() => {})
    } else if ((await head()) === fixup) {
      // It did not start (a pre-rebase hook said no): the changes are staged again.
      await run(repo, ['reset', '--soft', '-q', before])
    }
    throw err
  }
  if ((await count(repo, plan.range)) !== after + 1) {
    // Autosquash matched nothing and kept the fixup commit as one of its own. The tree is the same: back as before.
    await run(repo, ['reset', '--soft', '-q', before])
    throw new Error('git could not add the changes to that commit.')
  }
  return { hash: (await run(repo, ['rev-parse', `HEAD~${after}`])).trim() }
}
```

- [ ] **Step 5: Run the tests**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/fixup.test.ts`
Expected: PASS (19 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/git/fixup.ts src/main/git/repository.ts tests/fixup.test.ts
git commit -m "feat: add staged changes to an older commit with an autosquash rebase"
```

---

### Task 3: A stopped fixup — abort leaves everything as before

**Files:**
- Modify: `src/main/git/repository.ts` (`abortOperation`, ~line 1090)
- Test: `tests/fixup.test.ts`

**Interfaces:**
- Consumes: `FIXUP_MARK` (Task 2).
- Produces: `abortOperation(repo)` unchanged in signature; after aborting a fixup's rebase it soft-resets the fixup commit away.

- [ ] **Step 1: Write the failing tests** — append to `tests/fixup.test.ts`:

```ts
describe('a fixup stopped by a conflict', () => {
  /** "four" changes one.txt again: staging a change of those lines conflicts once it goes into "one". */
  async function stopped(): Promise<{ before: string; fixup: string }> {
    await commitFile('one.txt', 'one\nfour\n', 'four')
    await stageFile('one.txt', 'one\nfour\nstaged\n')
    writeFileSync(join(dir, 'two.txt'), 'two\nlocal\n')
    const before = await head()
    await expect(fixupCommit(dir, hashes.one)).rejects.toThrow()
    const mark = join(await out('rev-parse', '--absolute-git-dir'), 'rebase-merge', 'leviathan-fixup')
    return { before, fixup: readFileSync(mark, 'utf8').trim() }
  }

  it('stops with the rebase under way, marked as a fixup', async () => {
    const { before, fixup } = await stopped()
    expect((await repo.getState(dir)).operation).toBe('rebase')
    expect(await out('log', '-1', '--format=%s %P', fixup)).toBe(`fixup! one ${before}`)
  })

  it('leaves everything as before when aborted: the changes staged again, the others where they were', async () => {
    const { before } = await stopped()
    await repo.abortOperation(dir)
    expect((await repo.getState(dir)).operation).toBeNull()
    expect(await head()).toBe(before)
    expect(await staged()).toBe('one.txt')
    expect(readFileSync(join(dir, 'one.txt'), 'utf8')).toBe('one\nfour\nstaged\n')
    expect(readFileSync(join(dir, 'two.txt'), 'utf8')).toBe('two\nlocal\n')
    expect(await out('stash', 'list')).toBe('')
  })

  it('finishes once its conflicts are resolved and it is continued', async () => {
    await stopped()
    // It stops at each commit given the resolved file; "four", left with nothing of its own, is dropped by git.
    for (let i = 0; i < 3 && (await repo.getState(dir)).operation; i++) {
      writeFileSync(join(dir, 'one.txt'), 'one\nfour\nstaged\n')
      await repo.stage(dir, ['one.txt'])
      await repo.continueOperation(dir).catch(() => {})
    }
    expect((await repo.getState(dir)).operation).toBeNull()
    expect(await subjects()).not.toContain('fixup! one')
    expect(await out('show', 'HEAD:one.txt')).toBe('one\nfour\nstaged')
    expect(readFileSync(join(dir, 'two.txt'), 'utf8')).toBe('two\nlocal\n')
  })
})
```

- [ ] **Step 2: Run them to see the abort test fail**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/fixup.test.ts -t "stopped by a conflict"`
Expected: "leaves everything as before when aborted" FAILS (HEAD is the fixup commit, nothing staged); the other two PASS.

- [ ] **Step 3: Repair an aborted fixup in `abortOperation`** (`src/main/git/repository.ts`), replacing the function with:

```ts
/** The fixup commit of the rebase under way when it is a fixup's (`fixupCommit`), else null. */
async function stoppedFixup(repo: string): Promise<string | null> {
  const text = await fs.readFile(join(await gitDir(repo), 'rebase-merge', FIXUP_MARK), 'utf8').catch(() => null)
  return text?.trim() || null
}

export async function abortOperation(repo: string): Promise<void> {
  const op = await currentOperation(repo)
  if (!op) return
  // A fixup's rebase goes back to the commit made of the staged changes: they are staged again, as before it.
  const fixup = op === 'rebase' ? await stoppedFixup(repo) : null
  await run(repo, [op, '--abort'])
  await removeRebaseFiles(repo)
  if (fixup && (await run(repo, ['rev-parse', 'HEAD'])).trim() === fixup) {
    await run(repo, ['reset', '--soft', '-q', 'HEAD~1'])
  }
}
```

- [ ] **Step 4: Run the whole file, then the suites near it**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/fixup.test.ts tests/rebase.test.ts tests/rebaseInteractive.test.ts tests/operationStop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/git/repository.ts tests/fixup.test.ts
git commit -m "feat: aborting a stopped fixup stages the changes again"
```

---

### Task 4: Undo leaves the stash list alone for a fixup

**Files:**
- Modify: `src/shared/undo.ts` (after `diffSnapshots`, ~line 105)
- Modify: `src/renderer/src/undoStack.ts:17-25` (`StoppedAction`)
- Modify: `src/renderer/src/actions.ts` (`settleStoppedAction` ~849, `recordUndo` ~1163, `runOp` ~1222)
- Test: `tests/undo.test.ts`

**Interfaces:**
- Produces: `leavingStashes(before: Snapshot, after: Snapshot): { after: Snapshot; came: StashEntry[] }`; `StoppedAction.stashes?: boolean`; `recordUndo(path, label, mode, fn, paths = [], stashes = true)`; `runOp` option `undo.stashes?: boolean`.

- [ ] **Step 1: Write the failing test** — in `tests/undo.test.ts` change the import to `import { diffSnapshots, invertChange, leavingStashes, type Snapshot } from '../src/shared/undo'` and append:

```ts
describe('leavingStashes', () => {
  it('records the stash list as it was, and tells the stashes that came', () => {
    const mine = { commit: 's1', message: 'On main: mine' }
    const autostash = { commit: 's2', message: 'autostash' }
    const before: Snapshot = { ...snap('main', 'a', { 'refs/heads/main': 'a' }), stash: [mine] }
    const after: Snapshot = { ...snap('main', 'b', { 'refs/heads/main': 'b' }), stash: [autostash, mine] }
    const left = leavingStashes(before, after)
    expect(left.came).toEqual([autostash])
    const change = diffSnapshots(before, left.after, 'soft')
    expect(change?.stash).toBeUndefined()
    expect(change?.refs).toEqual([{ ref: 'refs/heads/main', from: 'a', to: 'b' }])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/undo.test.ts`
Expected: FAIL — `leavingStashes` is not exported.

- [ ] **Step 3: Add `leavingStashes` to `src/shared/undo.ts`**, after `diffSnapshots`:

```ts
/**
 * `after` as if the stash list had not changed since `before`, and the stashes that came meanwhile: for an action that
 * leaves the stash list out of what it records. A fixup's autostash that git could not apply is kept there; undoing
 * the fixup must not drop it, with the unstaged changes inside.
 */
export function leavingStashes(before: Snapshot, after: Snapshot): { after: Snapshot; came: StashEntry[] } {
  const came = (after.stash ?? []).filter((s) => !(before.stash ?? []).some((b) => b.commit === s.commit))
  return { after: { ...after, stash: before.stash }, came }
}
```

- [ ] **Step 4: Run it**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/undo.test.ts`
Expected: PASS.

- [ ] **Step 5: Carry the option through the renderer**

`src/renderer/src/undoStack.ts`, in `StoppedAction` after `since`:

```ts
  /** false: the stash list is left out of what is recorded (`leavingStashes`). */
  stashes?: boolean
```

`src/renderer/src/actions.ts`:

1. Import: `import { diffSnapshots, invertChange, leavingStashes, type RepoChange, type Snapshot } from '../../shared/undo'`.
2. Add above `settleStoppedAction`:

```ts
/** What is recorded of `after`: with `stashes` false, the stash list as `before` had it; a stash that came is told. */
function recordedAfter(before: Snapshot, after: Snapshot, stashes: boolean): Snapshot {
  if (stashes) return after
  const left = leavingStashes(before, after)
  if (left.came.length) toast('info', t('toast.changesWaitInStash', { name: left.came[0].message }))
  return left.after
}
```

3. In `settleStoppedAction`, replace the `change` line with:

```ts
    const change = after
      ? diffSnapshots(stopped.before, recordedAfter(stopped.before, after, stopped.stashes ?? true), stopped.mode)
      : null
```

4. `recordUndo`: add the parameter, keep it in the stopped action, use it for the change. Its doc gains one sentence: "`stashes` false: the stash list is left out (`leavingStashes`)."

```ts
async function recordUndo<T>(
  path: string,
  label: string,
  mode: RepoChange['mode'],
  fn: () => Promise<T>,
  paths: string[] | 'changes' = [],
  stashes = true
): Promise<T> {
```
```ts
      patchRepo(path, (r) => ({
        stopped: { label, mode, before, paths: copied, since: r.undo[r.undo.length - 1] ?? null, stashes }
      }))
```
```ts
    const change = before && after ? diffSnapshots(before, recordedAfter(before, after, stashes), mode) : null
```

5. `runOp`: the option and its use.

```ts
    /** `paths`: files it changes in the working tree or the index (a discard, a stash), copied to bring them back. */
    undo?: { label: string; mode?: RepoChange['mode']; paths?: string[] | 'changes'; stashes?: boolean }
```
```ts
    if (opts.undo) {
      const { label, mode, paths, stashes } = opts.undo
      await recordUndo(path, label, mode ?? 'keep', fn, paths, stashes ?? true)
    } else await fn()
```

- [ ] **Step 6: Typecheck and run the undo suites**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npm run typecheck; npx vitest run tests/undo.test.ts tests/undoStack.test.ts tests/undoApply.test.ts tests/undoTwice.test.ts`
Expected: no type errors; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/undo.ts src/renderer/src/undoStack.ts src/renderer/src/actions.ts tests/undo.test.ts
git commit -m "feat: an undo record can leave the stash list alone"
```

---

### Task 5: The menu item and the action

**Files:**
- Modify: `src/shared/api.ts` (interface ~line 133, `API_METHODS` ~line 430)
- Modify: `src/main/ipc.ts` (~line 143)
- Modify: `src/renderer/src/i18n/en.ts`, `src/renderer/src/i18n/es.ts`
- Modify: `src/renderer/src/actions.ts` (`commit` ~2331; new `fixupInto`)
- Modify: `src/renderer/src/menus.ts` (`commitMenu` ~184)

**Interfaces:**
- Consumes: `fixupInfo`, `fixupCommit` (Tasks 1-2); `FixupInfo` (Task 1); `runOp` `undo.stashes` (Task 4).
- Produces: `api.fixupInfo(repo, target): Promise<FixupInfo>`, `api.fixupCommit(repo, target, noSign?): Promise<{ hash: string }>`; `fixupInto(path: string, hash: string, noSign?: boolean): Promise<boolean>` exported from `actions.ts`; `signingQuiet(path, noSign, into)` and `commitUnsigned(failed)` (private to `actions.ts`).

- [ ] **Step 1: IPC.** `src/shared/api.ts`: add `import type { FixupInfo } from './fixup'` with the other type imports; in the interface, after `interactiveRebase`:

```ts
  /** Whether what is staged can be added to `target` now, or why not. */
  fixupInfo(repo: string, target: string): Promise<FixupInfo>
  /** Adds what is staged to `target`, a commit of the branch, and gives the commit it became; `noSign`: unsigned. */
  fixupCommit(repo: string, target: string, noSign?: boolean): Promise<{ hash: string }>
```

and in `API_METHODS`, after `interactiveRebase: true,`:

```ts
  fixupInfo: true,
  fixupCommit: true,
```

`src/main/ipc.ts`: `import * as fixup from './git/fixup'` with the other `./git/*` imports; after the `interactiveRebase` entry:

```ts
  fixupInfo: (path, target) => fixup.fixupInfo(path, target),
  fixupCommit: (path, target, noSign) => fixup.fixupCommit(path, target, noSign === true),
```

- [ ] **Step 2: Strings.** `src/renderer/src/i18n/en.ts`: after `'menu.interactiveRebase'`:

```ts
  'menu.fixupHere': 'Fixup: add staged changes here',
```

after `'toast.amendNotPushed'`:

```ts
  'toast.fixupDone': 'Changes added to "{name}"',
  'dlg.fixupPublishedTitle': 'Rewrite pushed commits?',
  'dlg.fixupPublished':
    'This rewrites {count} commits that are already on the remote. Pushing them afterwards needs Force push.',
  'dlg.fixupPublished_one':
    'This rewrites 1 commit that is already on the remote. Pushing it afterwards needs Force push.',
  'dlg.fixupPublishedConfirm': 'Add the changes',
```

after `'undo.interactiveRebase'`:

```ts
  'undo.fixup': 'fixup into "{name}"',
```

after `'error.operationInProgress'`:

```ts
  'error.fixup.operation': 'Finish or abort what is under way first.',
  'error.fixup.nothingStaged': 'Nothing is staged: stage the changes to add first.',
  'error.fixup.notAncestor': 'That commit is not on the current branch.',
  'error.fixup.merges': 'There are merges after that commit: use Interactive rebase from here… instead.',
  'error.fixup.pendingFixups':
    'There are fixup or squash commits after that commit: use Interactive rebase from here… instead.',
```

`src/renderer/src/i18n/es.ts`, at the same places:

```ts
  'menu.fixupHere': 'Fixup: añadir los cambios staged aquí',
```
```ts
  'toast.fixupDone': 'Cambios añadidos a "{name}"',
  'dlg.fixupPublishedTitle': '¿Reescribir commits ya subidos?',
  'dlg.fixupPublished':
    'Esto reescribe {count} commits que ya están en el remoto. Para subirlos después hará falta Force push.',
  'dlg.fixupPublished_one':
    'Esto reescribe 1 commit que ya está en el remoto. Para subirlo después hará falta Force push.',
  'dlg.fixupPublishedConfirm': 'Añadir los cambios',
```
```ts
  'undo.fixup': 'fixup en "{name}"',
```
```ts
  'error.fixup.operation': 'Termina o aborta antes lo que está en curso.',
  'error.fixup.nothingStaged': 'No hay nada staged: pon antes en staged los cambios que quieres añadir.',
  'error.fixup.notAncestor': 'Ese commit no está en la rama actual.',
  'error.fixup.merges': 'Hay merges después de ese commit: usa Rebase interactivo desde aquí… en su lugar.',
  'error.fixup.pendingFixups':
    'Hay commits fixup o squash después de ese commit: usa Rebase interactivo desde aquí… en su lugar.',
```

- [ ] **Step 3: Share the signing fallback.** In `src/renderer/src/actions.ts`, add above `commit`:

```ts
/**
 * A `quiet` for `runOp` around a commit: a failure to sign it is kept in `into` (no error toast) unless it was not to
 * be signed anyway, so the caller can offer to commit unsigned.
 */
function signingQuiet(path: string, noSign: boolean, into: { failed: string | null }) {
  return (err: unknown): boolean => {
    const text = errorMessage(err)
    if (noSign || !signingFailed(text) || getRepo(path)?.signing?.effective.sign === false) return false
    into.failed = text
    return true
  }
}

/** After a commit could not be signed (nothing was committed): true to commit unsigned this once. */
async function commitUnsigned(failed: string): Promise<boolean> {
  // The key could not sign: missing, locked, gpg not set up.
  const choice = await choiceDialog({
    title: t('signing.failedTitle'),
    message: t('signing.failed'),
    note: failed,
    choices: [
      { key: 'unsigned', label: t('signing.commitUnsigned'), primary: true },
      { key: 'settings', label: t('signing.openSettings') }
    ]
  })
  if (choice === 'settings') openSigningSettings()
  return choice === 'unsigned'
}
```

and in `commit`, replace the `quiet: (err) => { … }` option with `quiet: signingQuiet(path, noSign, signing)`, and the whole `if (signing.failed !== null) { … }` block with:

```ts
  if (signing.failed !== null) return (await commitUnsigned(signing.failed)) ? commit(path, true) : false
```

- [ ] **Step 4: `fixupInto`.** Add `import type { FixupInfo } from '../../shared/fixup'` to the imports of `actions.ts`, and after `commit`:

```ts
/**
 * Adds what is staged to `hash`, a commit of the current branch, rewriting those after it (git's `commit --fixup` and
 * an autosquash rebase). Asks first when some of them are already on a remote. `noSign`: not signed this once, after
 * signing failed (that question was answered already).
 */
export async function fixupInto(path: string, hash: string, noSign = false): Promise<boolean> {
  const operation = getRepo(path)?.state?.operation
  if (operation) {
    toast('error', t('error.operationInProgress', { operation: t(`op.${operation}`) }))
    return false
  }
  let info: FixupInfo
  try {
    info = await api.fixupInfo(path, hash)
  } catch (err) {
    toast('error', errorMessage(err))
    return false
  }
  if (!info.ok) {
    toast('error', t(`error.fixup.${info.reason}`))
    return false
  }
  if (!noSign && info.published > 0) {
    // Never force-pushed on its own, as after amending a pushed commit.
    const ok = await confirmDialog({
      title: t('dlg.fixupPublishedTitle'),
      message: t('dlg.fixupPublished', { count: info.published }),
      confirmText: t('dlg.fixupPublishedConfirm')
    })
    if (!ok) return false
  }
  const done = { hash: '' }
  const signing = { failed: null as string | null }
  const ok = await runOp(
    path,
    async () => {
      done.hash = (await api.fixupCommit(path, hash, noSign)).hash
    },
    {
      // Soft: undone, the changes are staged again. An autostash git kept in the stash list stays there.
      undo: { label: t('undo.fixup', { name: info.subject }), mode: 'soft', stashes: false },
      quiet: signingQuiet(path, noSign, signing)
    }
  )
  if (signing.failed !== null) return (await commitUnsigned(signing.failed)) ? fixupInto(path, hash, true) : false
  if (!ok) return false
  toast('success', t('toast.fixupDone', { name: info.subject }))
  await selectCommit(path, done.hash, true)
  return true
}
```

- [ ] **Step 5: The menu item.** `src/renderer/src/menus.ts`: add `fixupInto` to the import from `./actions` (alphabetical place); above `commitMenu`:

```ts
/** Adding what is staged to this commit: offered while something is staged and nothing is under way. */
function fixupItems(path: string, hash: string): MenuItem[] {
  const state = getRepo(path)?.state
  if (!state?.status.staged.length || state.operation || state.bisect) return []
  return [{ label: t('menu.fixupHere'), onClick: () => void fixupInto(path, hash) }]
}
```

and in `commitMenu`, right after the `menu.interactiveRebase` item:

```ts
    ...fixupItems(path, hash),
```

- [ ] **Step 6: Typecheck, format, full unit suite**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npm run typecheck; npx prettier --check src tests; npx vitest run`
Expected: no type errors, formatting clean (fix with `npx prettier --write <file>` if not), all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/api.ts src/main/ipc.ts src/renderer/src/i18n/en.ts src/renderer/src/i18n/es.ts src/renderer/src/actions.ts src/renderer/src/menus.ts
git commit -m "feat: Fixup: add staged changes here, from a commit's menu"
```

---

### Task 6: End to end, and the docs

**Files:**
- Modify: `e2e/app.spec.ts` (after the test "merges a branch as one commit…", ~line 593)
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `docs/STATUS.md` (after the **Interactive rebase** bullet, line 55)

**Interfaces:**
- Consumes: everything above, through the built app.

- [ ] **Step 1: Write the e2e tests** — in `e2e/app.spec.ts`, after the squash-merge test:

```ts
test('adds the staged changes to an older commit from its menu, and undoes it', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.write(repo, { 'b.txt': 'two\n' })
  box.git(repo, 'add', '.')
  box.git(repo, 'commit', '-qm', 'add b')
  box.write(repo, { 'c.txt': 'three\n' })
  box.git(repo, 'add', '.')
  box.git(repo, 'commit', '-qm', 'add c')
  box.write(repo, { 'a.txt': 'one\nmore\n', 'c.txt': 'three\nlocal\n' })
  box.git(repo, 'add', 'a.txt')
  const head = box.git(repo, 'rev-parse', 'HEAD')
  await open(repo)

  await commitRows().filter({ hasText: 'first' }).click({ button: 'right' })
  await menuItem('Fixup: add staged changes here').click()
  await expect(page.locator('.toast', { hasText: 'Changes added to "first"' })).toBeVisible()
  await expect.poll(() => box.git(repo, 'show', 'HEAD~2:a.txt')).toBe('one\nmore')
  expect(box.git(repo, 'log', '--format=%s')).toBe('add c\nadd b\nfirst')
  expect(box.git(repo, 'diff', '--cached', '--name-only')).toBe('')
  expect(box.read(repo, 'c.txt')).toBe('three\nlocal\n')
  await expect(commitRows().filter({ hasText: 'first' })).toHaveClass(/selected/)

  await toolbarButton('Undo').click()
  await expect.poll(() => box.git(repo, 'rev-parse', 'HEAD')).toBe(head)
  expect(box.git(repo, 'diff', '--cached', '--name-only')).toBe('a.txt')
  expect(box.read(repo, 'c.txt')).toBe('three\nlocal\n')
})

test('asks before adding the staged changes to a pushed commit, and Cancel changes nothing', async () => {
  const origin = join(box.root, 'origin.git')
  box.git(box.root, 'init', '-q', '--bare', '-b', 'main', origin)
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  box.write(repo, { 'b.txt': 'two\n' })
  box.git(repo, 'add', '.')
  box.git(repo, 'commit', '-qm', 'add b')
  box.git(repo, 'remote', 'add', 'origin', origin)
  box.git(repo, 'push', '-q', '-u', 'origin', 'main')
  box.write(repo, { 'a.txt': 'one\nmore\n' })
  box.git(repo, 'add', 'a.txt')
  const head = box.git(repo, 'rev-parse', 'HEAD')
  await open(repo)

  await commitRows().filter({ hasText: 'first' }).click({ button: 'right' })
  await menuItem('Fixup: add staged changes here').click()
  const modal = page.locator('.modal')
  await expect(modal).toContainText('This rewrites 2 commits that are already on the remote.')
  await modal.getByRole('button', { name: 'Cancel' }).click()
  await expect(modal).toHaveCount(0)
  expect(box.git(repo, 'rev-parse', 'HEAD')).toBe(head)
  expect(box.git(repo, 'diff', '--cached', '--name-only')).toBe('a.txt')
})
```

- [ ] **Step 2: Build and run them**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npm run build; npx playwright test -c e2e/playwright.config.ts -g "staged changes to"`
Expected: 2 passed. (If `box.read` returns a different shape than a string, check `e2e/app.ts` `read()` and adapt the two assertions.)

- [ ] **Step 3: Run the e2e tests near it** (squash merge, conflicts, undo) to see nothing else moved:

Run (PowerShell): `npx playwright test -c e2e/playwright.config.ts -g "undo|merge|conflict"`
Expected: all passed.

- [ ] **Step 4: CHANGELOG.** In `CHANGELOG.md`, under `## [Unreleased]`, before `### Fixed`:

```markdown
### Added

- **Staged changes can be added to an older commit**: right-click a commit of the current branch → *Fixup: add staged changes here*. The commits after it are rewritten with git's own fixup and autosquash, with no list to edit and no editor; unstaged changes are set aside and come back on their own. When some of those commits are already on a remote it asks first (pushing them again needs Force push). A conflict stops it with the usual banner, and *Abort* leaves everything as before, the changes staged again. One Undo takes it all back.

```

- [ ] **Step 5: STATUS.md.** In `docs/STATUS.md`, after the **Interactive rebase** bullet (line 55):

```markdown
- **Fixup into an older commit**: right-click a commit → *Fixup: add staged changes here*, shown while something is staged and nothing is under way. `fixupInfo` checks on click: the commit is on the branch, no merge and no pending `fixup!` / `squash!` / `amend!` subject from it to HEAD, and how many of the commits rewritten are on a remote (asked first). `fixupCommit` runs `git commit --fixup` (hooks and signing as any commit; "Commit unsigned" passes `--no-gpg-sign` to the rebase too), then `git rebase -i --autosquash --autostash` with `GIT_SEQUENCE_EDITOR=true` (over a user's `sequence.editor`), and checks that the fixup commit was melded (else a soft reset back). A rebase that did not start is soft-reset back; one that stopped gets `<rebase-merge>/leviathan-fixup` with the fixup commit, so `abortOperation` soft-resets it away (git deletes that folder when the rebase ends, so an abort in a terminal leaves the `fixup!` commit, which Undo takes away). Recorded for undo `soft`, leaving the stash list out (`leavingStashes`: an autostash git could not apply stays in the list). Code: `src/main/git/fixup.ts`, `src/shared/fixup.ts`, `fixupInto` in `actions.ts`.
```

- [ ] **Step 6: Format check and commit**

Run (PowerShell): `npx prettier --check e2e CHANGELOG.md docs/STATUS.md`
Expected: clean.

```bash
git add e2e/app.spec.ts CHANGELOG.md docs/STATUS.md
git commit -m "test: drive the fixup from the commit menu end to end; docs"
```
