# Publish a Local Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A repository without remotes can be published from Leviathan: the project is created on one of the user's
accounts through the provider's API, added as `origin` and pushed (Push button), or created right after `git init`
(Welcome → New repository).

**Architecture:** `src/shared/publish.ts` holds the name rules and the types. `providers.ts` gets `createProject` per
provider (GitHub, Gitea, GitLab, Bitbucket) and a shared `bitbucketWorkspaces`. A new main module `src/main/publish.ts`
does create → add `origin` → bind the account (like `src/main/clone.ts` does for clones). The renderer has one
`PublishDialog` (mounted in `App.tsx` like `RebaseDialog`), a `usePublishChoice` hook plus `PublishFields` shared with
the Welcome form, and `push()` opens the dialog when the repository has no remotes.

**Tech Stack:** Electron 45, React 19, zustand, TypeScript, vitest, Playwright.

Spec: `docs/superpowers/specs/2026-11-22-publish-repository-design.md`.

## Global Constraints

- Providers that publish: `github`, `gitlab`, `bitbucket`, `gitea`. `other` never publishes.
- The project always goes to the user (Bitbucket: a workspace of the user). No organisations, no groups.
- Remote name `origin`, HTTPS URL without a username in it.
- Private is checked by default.
- Bitbucket's permission to create repositories is `admin:repository:bitbucket` (checked in Atlassian's OpenAPI
  document: POST `/repositories/{workspace}/{repo_slug}`, `x-atlassian-oauth2-scopes`). Without a `project`, Bitbucket
  puts the repository in the workspace's oldest project.
- Every user-facing string goes in both `src/renderer/src/i18n/en.ts` and `es.ts` (the `es` dictionary must have every
  key of `en`, or `npm run typecheck` fails).
- Commits: no `Co-Authored-By` or any Claude attribution lines (user's standing order).
- Run vitest from PowerShell with `Set-Location D:\REPOS\Leviathan` first (a lowercase `d:` cwd makes vitest fail to
  find its runner).
- Code style: Prettier (`npm run format:check` must pass); comments explain why, in the codebase's plain English.

---

## File Structure

| File                                              | Change                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/shared/publish.ts`                           | Create: name rules (`projectName`, `projectNameProblem`, `bitbucketSlug`), `projectLocation`, `canPublish`, types |
| `src/main/accounts/providers.ts`                  | Modify: `reason()` reads GitLab's field errors; `request()` takes `need`; `bitbucketWorkspaces`; `createProject` |
| `src/main/accounts/index.ts`                      | Modify: `setRepoAccount(..., { keepIdentity })`, `publishingAccount`, `listAccountWorkspaces`     |
| `src/main/publish.ts`                             | Create: `publishRepository(path, input)`                                                         |
| `src/shared/api.ts`, `src/main/ipc.ts`            | Modify: `publishRepo`, `listAccountWorkspaces`                                                   |
| `src/renderer/src/store.ts`                       | Modify: `publish` state                                                                          |
| `src/renderer/src/components/PublishDialog.tsx`   | Create: `usePublishChoice`, `PublishFields`, `PublishDialog`                                     |
| `src/renderer/src/actions.ts`                     | Modify: `publishRepository`, `closePublish`, `openAccountsSettings`, `afterPublish`, `publishAndPush`, `push()`, `initRepository()` |
| `src/renderer/src/App.tsx`                        | Modify: mount `PublishDialog`                                                                    |
| `src/renderer/src/components/WelcomeView.tsx`     | Modify: `InitForm` checkbox and fields                                                           |
| `src/renderer/src/i18n/en.ts`, `es.ts`            | Modify: `publish.*`, three toasts, Bitbucket hint                                                |
| `src/renderer/src/styles/app.css`                 | Modify: `.publish-problem`                                                                       |
| `tests/publish.test.ts`                           | Create                                                                                           |
| `tests/providerClient.test.ts`                    | Modify: `createProject`, `bitbucketWorkspaces`                                                   |
| `tests/publishRepository.test.ts`                 | Create                                                                                           |
| `e2e/app.spec.ts`                                 | Modify: three tests                                                                              |
| `CHANGELOG.md`, `README.md`, `docs/STATUS.md`, `docs/ROADMAP.md` | Modify: document the feature                                                    |

---

### Task 1: Shared name rules and types

**Files:**
- Create: `src/shared/publish.ts`
- Test: `tests/publish.test.ts`

**Interfaces:**
- Consumes: `Account` from `src/shared/types.ts` (`provider`, `host`, `username`).
- Produces:
  - `interface NewProject { name: string; description: string; private: boolean; branch: string; workspace?: string }`
  - `interface CreatedProject { fullName: string; cloneUrl: string; webUrl: string }`
  - `interface PublishInput { accountId: string; name: string; description: string; private: boolean; workspace?: string }`
  - `interface Published { fullName: string; webUrl: string; host: string; bindError: string | null }`
  - `type ProjectNameProblem = 'empty' | 'tooLong' | 'characters' | 'dotGit' | 'edge'`
  - `PROJECT_NAME_MAX = 100`
  - `projectName(folder: string): string`
  - `projectNameProblem(name: string): ProjectNameProblem | null`
  - `bitbucketSlug(name: string): string`
  - `projectLocation(account: Pick<Account, 'provider' | 'host' | 'username'>, workspace: string, name: string): string`
  - `canPublish(account: Pick<Account, 'provider'>): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/publish.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  bitbucketSlug,
  canPublish,
  projectLocation,
  projectName,
  projectNameProblem,
  PROJECT_NAME_MAX
} from '../src/shared/publish'

describe('projectName', () => {
  it('keeps a name servers accept as it is', () => {
    expect(projectName('game')).toBe('game')
    expect(projectName('My_Game-2.0')).toBe('My_Game-2.0')
  })

  it('turns spaces and symbols into one dash each run', () => {
    expect(projectName('My Game')).toBe('My-Game')
    expect(projectName('a  &  b')).toBe('a-b')
    expect(projectName('  padded  ')).toBe('padded')
  })

  it('drops accents instead of the letters', () => {
    expect(projectName('Juego Ñandú')).toBe('Juego-Nandu')
  })

  it('drops dots and dashes at the edges, and a trailing .git', () => {
    expect(projectName('.hidden')).toBe('hidden')
    expect(projectName('-x-')).toBe('x')
    expect(projectName('game.git')).toBe('game')
    expect(projectName('game-.git')).toBe('game')
  })

  it('cuts a long name, without leaving a dash at the end', () => {
    const name = projectName('a'.repeat(99) + ' bcd')
    expect(name.length).toBeLessThanOrEqual(PROJECT_NAME_MAX)
    expect(name).toBe('a'.repeat(99))
  })

  it('may leave nothing', () => {
    expect(projectName('***')).toBe('')
    expect(projectName('')).toBe('')
  })
})

describe('projectNameProblem', () => {
  it('accepts what projectName makes', () => {
    expect(projectNameProblem('My-Game')).toBeNull()
    expect(projectNameProblem('a.b_c-d')).toBeNull()
  })

  it('says what is wrong', () => {
    expect(projectNameProblem('')).toBe('empty')
    expect(projectNameProblem('a'.repeat(101))).toBe('tooLong')
    expect(projectNameProblem('my game')).toBe('characters')
    expect(projectNameProblem('juego-ñ')).toBe('characters')
    expect(projectNameProblem('game.git')).toBe('dotGit')
    expect(projectNameProblem('-game')).toBe('edge')
    expect(projectNameProblem('game.')).toBe('edge')
  })
})

describe('bitbucketSlug', () => {
  it('is the name in lower case', () => {
    expect(bitbucketSlug('My-Game')).toBe('my-game')
  })
})

describe('projectLocation', () => {
  it('is the user and the name on the host', () => {
    expect(projectLocation({ provider: 'github', host: 'github.com', username: 'ana' }, '', 'game')).toBe(
      'github.com/ana/game'
    )
  })

  it('on Bitbucket, the workspace and the slug', () => {
    expect(projectLocation({ provider: 'bitbucket', host: 'bitbucket.org', username: 'ana' }, 'team', 'My-Game')).toBe(
      'bitbucket.org/team/my-game'
    )
  })
})

describe('canPublish', () => {
  it('needs a provider with an API', () => {
    expect(canPublish({ provider: 'github' })).toBe(true)
    expect(canPublish({ provider: 'gitlab' })).toBe(true)
    expect(canPublish({ provider: 'bitbucket' })).toBe(true)
    expect(canPublish({ provider: 'gitea' })).toBe(true)
    expect(canPublish({ provider: 'other' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/publish.test.ts`
Expected: FAIL, "Failed to resolve import ../src/shared/publish" (or similar: the module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/shared/publish.ts`:

```ts
import type { Account } from './types'

/** What creating a project on a server takes. */
export interface NewProject {
  name: string
  description: string
  private: boolean
  /** The branch pushed first ('' on a detached HEAD): Gitea's default branch. */
  branch: string
  /** Bitbucket: the workspace the repository goes to. */
  workspace?: string
}

/** A project just created on a server. */
export interface CreatedProject {
  /** `owner/name` (GitLab: the whole namespace path). */
  fullName: string
  /** HTTPS address to add as `origin`, without a username in it. */
  cloneUrl: string
  /** The project's page. */
  webUrl: string
}

/** What the renderer asks for to publish a repository. */
export interface PublishInput {
  accountId: string
  name: string
  description: string
  private: boolean
  workspace?: string
}

/** A repository published: where its project is, and why it could not be given the account (null: it was). */
export interface Published {
  fullName: string
  webUrl: string
  host: string
  bindError: string | null
}

export type ProjectNameProblem = 'empty' | 'tooLong' | 'characters' | 'dotGit' | 'edge'

/** GitHub's limit, the lowest of the four servers. */
export const PROJECT_NAME_MAX = 100

/** Drops dots and dashes at the edges and a trailing `.git`, until none is left (`x-.git` → `x`). */
function tidy(name: string): string {
  let out = name
  for (;;) {
    const next = out.replace(/^[-.]+|[-.]+$/g, '').replace(/\.git$/i, '')
    if (next === out) return out
    out = next
  }
}

/**
 * A project name made from a folder name, one every server accepts: letters without their accents, digits, `.`, `-`
 * and `_`, every other run of characters one `-`. '' when nothing is left.
 */
export function projectName(folder: string): string {
  const name = folder
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
  return tidy(tidy(name).slice(0, PROJECT_NAME_MAX))
}

/** Why `name` cannot be a project's name, or null when it can. */
export function projectNameProblem(name: string): ProjectNameProblem | null {
  if (!name) return 'empty'
  if (name.length > PROJECT_NAME_MAX) return 'tooLong'
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'characters'
  if (/\.git$/i.test(name)) return 'dotGit'
  if (/^[-.]|[-.]$/.test(name)) return 'edge'
  return null
}

/** Bitbucket's slug of a repository name: the same characters, in lower case. */
export function bitbucketSlug(name: string): string {
  return name.toLowerCase()
}

/** Where a project will be, as the dialog shows it: `github.com/ana/game`, `bitbucket.org/team/game`. */
export function projectLocation(
  account: Pick<Account, 'provider' | 'host' | 'username'>,
  workspace: string,
  name: string
): string {
  return account.provider === 'bitbucket'
    ? `${account.host}/${workspace}/${bitbucketSlug(name)}`
    : `${account.host}/${account.username}/${name}`
}

/** Whether an account can create projects: "Other" has no API. */
export function canPublish(account: Pick<Account, 'provider'>): boolean {
  return account.provider !== 'other'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/publish.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/shared/publish.ts tests/publish.test.ts
git add src/shared/publish.ts tests/publish.test.ts
git commit -m "feat: name rules for publishing a repository to an account"
```

---

### Task 2: `createProject` and the error texts in `providers.ts`

**Files:**
- Modify: `src/main/accounts/providers.ts` (`reason()` ~line 40, `request()` ~line 53, `bitbucketRepos()` ~line 442, new
  section at the end of the file)
- Test: `tests/providerClient.test.ts` (append)

**Interfaces:**
- Consumes: `NewProject`, `CreatedProject`, `bitbucketSlug` from Task 1.
- Produces:
  - `createProject(provider: Provider, host: string, token: string, input: NewProject, fetchFn?: FetchFn): Promise<CreatedProject>`
  - `bitbucketWorkspaces(host: string, token: string, fetchFn?: FetchFn): Promise<string[]>`
  - `CREATE_PERMISSION: string`

- [ ] **Step 1: Write the failing tests**

In `tests/providerClient.test.ts`, add `bitbucketWorkspaces` and `createProject` to the import from
`'../src/main/accounts/providers'`, then append at the end of the file:

```ts
describe('createProject', () => {
  const input = { name: 'game', description: 'A game', private: true, branch: 'main' }

  it('creates a GitHub repository of the user', async () => {
    const { fn, calls } = fakeFetch({
      'https://api.github.com/user/repos': {
        status: 201,
        body: {
          full_name: 'ana/game',
          clone_url: 'https://github.com/ana/game.git',
          html_url: 'https://github.com/ana/game'
        }
      }
    })
    expect(await createProject('github', 'github.com', TOKEN, input, fn)).toEqual({
      fullName: 'ana/game',
      cloneUrl: 'https://github.com/ana/game.git',
      webUrl: 'https://github.com/ana/game'
    })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ name: 'game', description: 'A game', private: true, auto_init: false })
  })

  it('gives Gitea the default branch', async () => {
    const { fn, calls } = fakeFetch({
      'https://git.example.com/api/v1/user/repos': {
        status: 201,
        body: {
          full_name: 'ana/game',
          clone_url: 'https://git.example.com/ana/game.git',
          html_url: 'https://git.example.com/ana/game'
        }
      }
    })
    await createProject('gitea', 'git.example.com', TOKEN, { ...input, branch: 'develop' }, fn)
    expect(calls[0].body).toEqual({
      name: 'game',
      description: 'A game',
      private: true,
      auto_init: false,
      default_branch: 'develop'
    })
  })

  it('creates a GitLab project with its visibility', async () => {
    const { fn, calls } = fakeFetch({
      'https://gitlab.com/api/v4/projects': {
        status: 201,
        body: {
          path_with_namespace: 'bo/game',
          http_url_to_repo: 'https://gitlab.com/bo/game.git',
          web_url: 'https://gitlab.com/bo/game'
        }
      }
    })
    const created = await createProject('gitlab', 'gitlab.com', TOKEN, { ...input, private: false }, fn)
    expect(created.fullName).toBe('bo/game')
    expect(calls[0].body).toEqual({ name: 'game', path: 'game', description: 'A game', visibility: 'public' })
  })

  it('creates a Bitbucket repository in a workspace, its address without a username', async () => {
    const { fn, calls } = fakeFetch({
      'https://api.bitbucket.org/2.0/repositories/team/my-game': {
        body: {
          full_name: 'team/my-game',
          links: {
            html: { href: 'https://bitbucket.org/team/my-game' },
            clone: [{ name: 'https', href: 'https://ana@bitbucket.org/team/my-game.git' }]
          }
        }
      }
    })
    const created = await createProject(
      'bitbucket',
      'bitbucket.org',
      TOKEN,
      { ...input, name: 'My-Game', workspace: 'team' },
      fn
    )
    expect(created).toEqual({
      fullName: 'team/my-game',
      cloneUrl: 'https://bitbucket.org/team/my-game.git',
      webUrl: 'https://bitbucket.org/team/my-game'
    })
    expect(calls[0].body).toEqual({ scm: 'git', name: 'My-Game', description: 'A game', is_private: true })
  })

  it('needs a workspace on Bitbucket', async () => {
    const { fn, calls } = fakeFetch({})
    await expect(createProject('bitbucket', 'bitbucket.org', TOKEN, input, fn)).rejects.toThrow(/workspace/)
    expect(calls).toHaveLength(0)
  })

  it('says why a name is taken (GitHub)', async () => {
    const { fn } = fakeFetch({
      'https://api.github.com/user/repos': {
        status: 422,
        body: {
          message: 'Repository creation failed.',
          errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }]
        }
      }
    })
    await expect(createProject('github', 'github.com', TOKEN, input, fn)).rejects.toThrow(
      'GitHub answered with an error (422): name already exists on this account'
    )
  })

  it("reads GitLab's errors per field", async () => {
    const { fn } = fakeFetch({
      'https://gitlab.com/api/v4/projects': {
        status: 400,
        body: { message: { name: ['has already been taken'], path: ['has already been taken'], limit_reached: [] } }
      }
    })
    await expect(createProject('gitlab', 'gitlab.com', TOKEN, input, fn)).rejects.toThrow(
      'GitLab answered with an error (400): name has already been taken, path has already been taken'
    )
  })

  it('says why a name is taken (Gitea)', async () => {
    const { fn } = fakeFetch({
      'https://git.example.com/api/v1/user/repos': {
        status: 409,
        body: { message: 'The repository with the same name already exists.' }
      }
    })
    await expect(createProject('gitea', 'git.example.com', TOKEN, input, fn)).rejects.toThrow(
      'Gitea answered with an error (409): The repository with the same name already exists.'
    )
  })

  it('names the Bitbucket permission a token lacks', async () => {
    const { fn } = fakeFetch({
      'https://api.bitbucket.org/2.0/repositories/team/game': {
        status: 403,
        body: {
          type: 'error',
          error: {
            message: 'Your credentials lack one or more required privilege scopes.',
            detail: { granted: ['read:repository:bitbucket'], required: ['admin:repository:bitbucket'] }
          }
        }
      }
    })
    await expect(
      createProject('bitbucket', 'bitbucket.org', TOKEN, { ...input, workspace: 'team' }, fn)
    ).rejects.toThrow(/it needs admin:repository:bitbucket/)
  })

  it('speaks of creating repositories, not of pull requests, when refused', async () => {
    const { fn } = fakeFetch({ 'https://api.github.com/user/repos': { status: 403, body: {} } })
    await expect(createProject('github', 'github.com', TOKEN, input, fn)).rejects.toThrow(
      /permission to create repositories/
    )
  })

  it('refuses an answer without the address of the project', async () => {
    const { fn } = fakeFetch({ 'https://api.github.com/user/repos': { status: 201, body: { full_name: 'ana/game' } } })
    await expect(createProject('github', 'github.com', TOKEN, input, fn)).rejects.toThrow(
      "GitHub answered without the new project's address"
    )
  })

  it('cannot create anything on a server without an API', async () => {
    const { fn } = fakeFetch({})
    await expect(createProject('other', 'git.example.com', TOKEN, input, fn)).rejects.toThrow(/no API/)
  })
})

describe('bitbucketWorkspaces', () => {
  it('lists the slugs of the workspaces of the user', async () => {
    const { fn } = fakeFetch({
      'https://api.bitbucket.org/2.0/user/workspaces?pagelen=100': {
        body: { values: [{ workspace: { slug: 'ana' } }, { workspace: { slug: 'team' } }, { workspace: {} }] }
      }
    })
    expect(await bitbucketWorkspaces('bitbucket.org', TOKEN, fn)).toEqual(['ana', 'team'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/providerClient.test.ts`
Expected: FAIL, `createProject` / `bitbucketWorkspaces` are not exported (the existing tests still pass).

- [ ] **Step 3: Read GitLab's field errors in `reason()`**

In `src/main/accounts/providers.ts`, replace the line

```ts
  const message = Array.isArray(b.message) ? b.message.join(', ') : b.message
```

with

```ts
  const message = Array.isArray(b.message)
    ? b.message.join(', ')
    : b.message && typeof b.message === 'object'
      ? fieldErrors(b.message as Json)
      : b.message
```

and add above `reason()`:

```ts
/** GitLab's validation errors, `{ name: ['has already been taken'] }`, as `name has already been taken`. */
function fieldErrors(fields: Json): string {
  return Object.entries(fields)
    .map(([field, errors]) => {
      const list = Array.isArray(errors) ? errors.map(String).filter(Boolean) : errors ? [String(errors)] : []
      return list.length ? `${field} ${list.join(', ')}` : ''
    })
    .filter(Boolean)
    .join(', ')
}
```

- [ ] **Step 4: Let a change name the permission it needs in `request()`**

Change the `send` parameter type of `request()` from

```ts
  send?: { method: 'POST' | 'PATCH' | 'PUT'; body: Json }
```

to

```ts
  /** `need`: the permission the change needs, said when the server refuses the token (pull requests by default). */
  send?: { method: 'POST' | 'PATCH' | 'PUT'; body: Json; need?: string }
```

and replace

```ts
    const permission =
      'permission to change pull requests (GitHub: repo, GitLab: api, Bitbucket: write:pullrequest:bitbucket)'
```

with

```ts
    const permission =
      send?.need ??
      'permission to change pull requests (GitHub: repo, GitLab: api, Bitbucket: write:pullrequest:bitbucket)'
```

- [ ] **Step 5: Move the workspaces out of `bitbucketRepos`**

Replace the first statement of `bitbucketRepos()`:

```ts
  const workspaces = items(await getJson('bitbucket', host, '/user/workspaces?pagelen=100', token, fetchFn))
    .map((w) => (w.workspace && typeof w.workspace === 'object' ? String((w.workspace as Json).slug ?? '') : ''))
    .filter(Boolean)
    .slice(0, 50)
```

with

```ts
  const workspaces = (await bitbucketWorkspaces(host, token, fetchFn)).slice(0, 50)
```

and add, right above `bitbucketRepos()`:

```ts
/** The slugs of the user's Bitbucket workspaces (where its repositories are, and where new ones can go). */
export async function bitbucketWorkspaces(host: string, token: string, fetchFn: FetchFn = fetch): Promise<string[]> {
  return items(await getJson('bitbucket', host, '/user/workspaces?pagelen=100', token, fetchFn))
    .map((w) => (w.workspace && typeof w.workspace === 'object' ? String((w.workspace as Json).slug ?? '') : ''))
    .filter(Boolean)
}
```

- [ ] **Step 6: Add `createProject` at the end of the file**

Add to the import at the top of `src/main/accounts/providers.ts`:

```ts
import { bitbucketSlug, type CreatedProject, type NewProject } from '../../shared/publish'
```

Append at the end of the file (after the pull request review section, where the `at` helper is defined):

```ts
// ---------------------------------------------------------------------------
// Publishing a repository: creating its project on the user's account.

export const CREATE_PERMISSION =
  'permission to create repositories (GitHub: repo, GitLab: api, Bitbucket: admin:repository:bitbucket)'

/**
 * Creates an empty project of the token's user (Bitbucket: in `input.workspace`), nothing in it: the repository is
 * pushed to it afterwards. Its HTTPS address carries no username, so git uses the account the repository is bound to.
 */
export async function createProject(
  provider: Provider,
  host: string,
  token: string,
  input: NewProject,
  fetchFn: FetchFn = fetch
): Promise<CreatedProject> {
  const post = async (path: string, body: Json) =>
    (await request(provider, host, path, token, fetchFn, { method: 'POST', body, need: CREATE_PERMISSION })) as Json | null
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  let fullName: string | null
  let cloneUrl: string | null
  let webUrl: string | null
  switch (provider) {
    case 'github':
    case 'gitea': {
      const body: Json = { name: input.name, description: input.description, private: input.private, auto_init: false }
      // Whether Gitea's first push into an empty repository makes its branch the default differs between versions.
      if (provider === 'gitea' && input.branch) body.default_branch = input.branch
      const created = await post('/user/repos', body)
      ;[fullName, cloneUrl, webUrl] = [text(created?.full_name), text(created?.clone_url), text(created?.html_url)]
      break
    }
    case 'gitlab': {
      const created = await post('/projects', {
        name: input.name,
        path: input.name,
        description: input.description,
        visibility: input.private ? 'private' : 'public'
      })
      ;[fullName, cloneUrl, webUrl] = [
        text(created?.path_with_namespace),
        text(created?.http_url_to_repo),
        text(created?.web_url)
      ]
      break
    }
    case 'bitbucket': {
      if (!input.workspace) throw new Error('Pick the Bitbucket workspace the repository goes to')
      const slug = bitbucketSlug(input.name)
      // Without a project, Bitbucket puts the repository in the workspace's oldest one.
      const created = await post(`/repositories/${encodeURIComponent(input.workspace)}/${encodeURIComponent(slug)}`, {
        scm: 'git',
        name: input.name,
        description: input.description,
        is_private: input.private
      })
      fullName = text(created?.full_name)
      // Not Bitbucket's clone link, which carries the username (see bitbucketRepos).
      cloneUrl = fullName && `https://${host}/${fullName}.git`
      webUrl = text(at(at(created?.links, 'html'), 'href'))
      break
    }
    default:
      throw new Error('This provider has no API support')
  }
  if (!fullName || !cloneUrl || !webUrl) throw new Error(`${LABELS[provider]} answered without the new project's address`)
  return { fullName, cloneUrl, webUrl }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/providerClient.test.ts tests/bitbucketAccounts.test.ts`
Expected: PASS (new tests and the existing Bitbucket repository listing alike).

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
npx prettier --write src/main/accounts/providers.ts tests/providerClient.test.ts
git add src/main/accounts/providers.ts tests/providerClient.test.ts
git commit -m "feat: create an empty project on GitHub, GitLab, Bitbucket or Gitea"
```

---

### Task 3: `publishRepository` in the main process, and its IPC

**Files:**
- Modify: `src/main/accounts/index.ts` (`setRepoAccount` ~line 291; new functions after `listAccountRepos` ~line 273)
- Create: `src/main/publish.ts`
- Modify: `src/shared/api.ts` (interface next to `listAccountRepos` ~line 249; `METHODS` next to `listAccountRepos: true`
  ~line 500)
- Modify: `src/main/ipc.ts` (imports; handlers next to `listAccountRepos` ~line 243)
- Test: `tests/publishRepository.test.ts`

**Interfaces:**
- Consumes: `createProject` (Task 2), `PublishInput`, `Published`, `projectNameProblem` (Task 1).
- Produces:
  - `setRepoAccount(repo: string, accountId: string | null, opts?: { keepIdentity?: boolean }): Promise<void>`
  - `publishingAccount(id: string): Promise<{ account: Account; token: string }>`
  - `listAccountWorkspaces(id: string): Promise<string[]>`
  - `publishRepository(path: string, input: PublishInput): Promise<Published>` in `src/main/publish.ts`
  - renderer API: `api.publishRepo(repo: string, input: PublishInput): Promise<Published>`,
    `api.listAccountWorkspaces(id: string): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Create `tests/publishRepository.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The account store needs Electron; the server is not asked. The "created" project is a bare repository here.
vi.mock('../src/main/accounts', () => ({ publishingAccount: vi.fn(), setRepoAccount: vi.fn() }))
vi.mock('../src/main/accounts/providers', () => ({ createProject: vi.fn() }))

const accounts = await import('../src/main/accounts')
const providers = await import('../src/main/accounts/providers')
const { publishRepository } = await import('../src/main/publish')
const { git } = await import('../src/main/git/runner')

const ana = {
  id: 'a1',
  provider: 'github' as const,
  host: 'github.com',
  username: 'ana',
  name: 'Ana',
  email: '5+ana@users.noreply.github.com'
}
const input = { accountId: 'a1', name: 'game', description: ' A game ', private: true }
const clean = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false']

let root: string
let work: string
let bare: string

const remotes = async () => (await git(['remote'], { cwd: work })).stdout.trim()

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-publish-'))
  work = join(root, 'work')
  bare = join(root, 'remote.git')
  await git(['init', '-q', '--bare', '-b', 'main', bare], { cwd: root })
  await git(['init', '-q', '-b', 'main', work], { cwd: root })
  await git([...clean, 'commit', '-q', '--allow-empty', '-m', 'first'], { cwd: work })
  vi.mocked(accounts.publishingAccount).mockReset().mockResolvedValue({ account: ana, token: 'tok' })
  vi.mocked(accounts.setRepoAccount).mockReset().mockResolvedValue(undefined)
  vi.mocked(providers.createProject)
    .mockReset()
    .mockResolvedValue({ fullName: 'ana/game', cloneUrl: bare, webUrl: 'https://github.com/ana/game' })
})

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('publishRepository', () => {
  it('creates the project, adds it as origin and gives the repository the account', async () => {
    const published = await publishRepository(work, input)

    expect(published).toEqual({
      fullName: 'ana/game',
      webUrl: 'https://github.com/ana/game',
      host: 'github.com',
      bindError: null
    })
    expect(providers.createProject).toHaveBeenCalledWith('github', 'github.com', 'tok', {
      name: 'game',
      description: 'A game',
      private: true,
      branch: 'main',
      workspace: undefined
    })
    expect((await git(['remote', 'get-url', 'origin'], { cwd: work })).stdout.trim()).toBe(bare)
    expect(accounts.setRepoAccount).toHaveBeenCalledWith(work, 'a1', { keepIdentity: false })
    // The push that follows reaches it.
    await git(['push', '-q', 'origin', 'main'], { cwd: work })
    const pushed = (await git(['rev-parse', 'main'], { cwd: bare })).stdout.trim()
    expect(pushed).toBe((await git(['rev-parse', 'main'], { cwd: work })).stdout.trim())
  })

  it("keeps a repository's own identity", async () => {
    await git(['config', '--local', 'user.name', 'Own'], { cwd: work })
    await publishRepository(work, input)
    expect(accounts.setRepoAccount).toHaveBeenCalledWith(work, 'a1', { keepIdentity: true })
  })

  it('reads the branch of a repository with no commits yet', async () => {
    const empty = join(root, 'empty')
    await git(['init', '-q', '-b', 'trunk', empty], { cwd: root })
    await publishRepository(empty, input)
    expect(vi.mocked(providers.createProject).mock.calls[0][3].branch).toBe('trunk')
  })

  it('refuses a repository that has origin already, before asking the server', async () => {
    await git(['remote', 'add', 'origin', bare], { cwd: work })
    await expect(publishRepository(work, input)).rejects.toThrow('This repository already has a remote named origin')
    expect(providers.createProject).not.toHaveBeenCalled()
  })

  it('leaves the repository as it was when the server refuses', async () => {
    vi.mocked(providers.createProject).mockRejectedValue(
      new Error('GitHub answered with an error (422): name already exists on this account')
    )
    await expect(publishRepository(work, input)).rejects.toThrow('name already exists on this account')
    expect(await remotes()).toBe('')
    expect(accounts.setRepoAccount).not.toHaveBeenCalled()
  })

  it('says where the project is when it cannot be added as origin', async () => {
    vi.mocked(providers.createProject).mockResolvedValue({
      fullName: 'ana/game',
      cloneUrl: '-not-a-url',
      webUrl: 'https://github.com/ana/game'
    })
    await expect(publishRepository(work, input)).rejects.toThrow(
      /The project was created at https:\/\/github\.com\/ana\/game, but it could not be added as origin/
    )
  })

  it('is published all the same when the account cannot be given to the repository', async () => {
    vi.mocked(accounts.setRepoAccount).mockRejectedValue(new Error('settings.json is read-only'))
    const published = await publishRepository(work, input)
    expect(published.bindError).toBe('settings.json is read-only')
    expect(await remotes()).toBe('origin')
  })

  it('refuses a name no server takes, before anything else', async () => {
    await expect(publishRepository(work, { ...input, name: 'my game' })).rejects.toThrow('Invalid repository name')
    expect(accounts.publishingAccount).not.toHaveBeenCalled()
  })

  it('needs a workspace for Bitbucket', async () => {
    vi.mocked(accounts.publishingAccount).mockResolvedValue({
      account: { ...ana, provider: 'bitbucket', host: 'bitbucket.org' },
      token: 'tok'
    })
    await expect(publishRepository(work, input)).rejects.toThrow(/workspace/)
    expect(providers.createProject).not.toHaveBeenCalled()
  })

  it('refuses what is not a publish request', async () => {
    await expect(publishRepository(work, { ...input, private: 'yes' } as never)).rejects.toThrow(
      'Invalid repository to publish'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/publishRepository.test.ts`
Expected: FAIL, `../src/main/publish` cannot be resolved.

- [ ] **Step 3: Add the account functions**

In `src/main/accounts/index.ts`:

1. Add `bitbucketWorkspaces` to the import list from `'./providers'`.
2. Replace `setRepoAccount` with:

```ts
/**
 * Binds a repository to an account (its commit identity and HTTPS credentials),
 * or unbinds it with `null`. Unbinding leaves the repository's identity as it is; so does binding with
 * `keepIdentity` (a repository with an identity of its own, published to the account).
 */
export async function setRepoAccount(
  repo: string,
  accountId: string | null,
  opts: { keepIdentity?: boolean } = {}
): Promise<void> {
  const map = { ...(loadSettings().repoAccounts ?? {}) }
  // One entry per repository, whatever the case its path came in.
  const entry = repoEntry(map, repo)
  if (entry !== undefined) delete map[entry]
  if (accountId) {
    const account = requireAccount(accountId)
    if (!opts.keepIdentity) await applyIdentity(repo, account)
    setRepoGitArgs(repo, credentialArgs(account))
    map[repo] = accountId
  } else {
    setRepoGitArgs(repo, null)
    delete map[repo]
  }
  saveSettings({ repoAccounts: map })
}
```

3. After `listAccountRepos`, add:

```ts
/** Bitbucket: the workspaces of an account, where a repository can be created. Other providers: none. */
export async function listAccountWorkspaces(id: string): Promise<string[]> {
  const account = requireAccount(id)
  if (account.provider !== 'bitbucket') return []
  return bitbucketWorkspaces(account.host, (await freshToken(id)) ?? '')
}

/** An account that can create projects, with its token (renewed first when about to expire). */
export async function publishingAccount(id: string): Promise<{ account: Account; token: string }> {
  const account = requireAccount(id)
  if (account.provider === 'other') throw new Error('This account has no API to create a repository with')
  const token = await freshToken(id)
  if (!token) {
    const reason = accounts().unreadable(id)
    throw new Error(
      `The token of ${account.username}@${account.host} can no longer be read on this system${reason ? ` (${reason})` : ''}: add the account again.`
    )
  }
  return { account, token }
}
```

- [ ] **Step 4: Create `src/main/publish.ts`**

```ts
import { parseRemotes } from '../shared/parsers'
import { projectNameProblem, type Published, type PublishInput } from '../shared/publish'
import * as accounts from './accounts'
import { createProject } from './accounts/providers'
import { readIdentity } from './git/identity'
import * as repo from './git/repository'
import { git } from './git/runner'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function validInput(input: PublishInput): boolean {
  return (
    !!input &&
    typeof input.accountId === 'string' &&
    typeof input.name === 'string' &&
    typeof input.description === 'string' &&
    typeof input.private === 'boolean' &&
    (input.workspace === undefined || typeof input.workspace === 'string')
  )
}

/**
 * Creates the project of a repository on one of the user's accounts, adds it as `origin` and binds the repository to
 * the account, so the push that follows goes through that account and no other stored credential. Nothing is
 * changed here when the server refuses; once the project exists, failing to bind the account is only reported.
 */
export async function publishRepository(path: string, input: PublishInput): Promise<Published> {
  if (!validInput(input)) throw new Error('Invalid repository to publish')
  const name = input.name.trim()
  if (projectNameProblem(name)) throw new Error(`Invalid repository name: "${name}"`)
  const { account, token } = await accounts.publishingAccount(input.accountId)
  if (account.provider === 'bitbucket' && !input.workspace) {
    throw new Error('Pick the Bitbucket workspace the repository goes to')
  }
  const { stdout } = await git(['remote', '-v'], { cwd: path })
  if (parseRemotes(stdout).some((r) => r.name === 'origin')) {
    throw new Error('This repository already has a remote named origin')
  }
  // Also on a branch with no commits yet; '' on a detached HEAD.
  const head = await git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: path, okCodes: [0, 1] })
  const created = await createProject(account.provider, account.host, token, {
    name,
    description: input.description.trim(),
    private: input.private,
    branch: head.stdout.trim(),
    workspace: input.workspace
  })
  try {
    await repo.addRemote(path, 'origin', created.cloneUrl)
  } catch (err) {
    throw new Error(
      `The project was created at ${created.webUrl}, but it could not be added as origin: ${message(err)}. Add it with Add remote.`
    )
  }
  // A repository with an identity of its own keeps it; one without takes the account's, as when it is opened.
  const { local } = await readIdentity(path).catch(() => ({ local: { name: '', email: '' } }))
  const bindError = await accounts
    .setRepoAccount(path, account.id, { keepIdentity: !!(local.name || local.email) })
    .then(
      () => null,
      (err: unknown) => message(err)
    )
  return { fullName: created.fullName, webUrl: created.webUrl, host: account.host, bindError }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/publishRepository.test.ts`
Expected: PASS. If `git(['remote', '-v'], ...)` fails on a repository without remotes, check `RunOptions` in
`src/main/git/runner.ts` (it should not: `git remote -v` exits 0 with no output).

- [ ] **Step 6: Wire the IPC**

In `src/shared/api.ts`:

1. Add the import: `import type { PublishInput, Published } from './publish'`.
2. In `LeviathanInvokeApi`, after `listAccountRepos(id: string): Promise<RemoteRepo[]>`:

```ts
  /** Bitbucket: the workspaces of an account (other providers: none). */
  listAccountWorkspaces(id: string): Promise<string[]>
  /** Creates the repository's project on an account, adds it as origin and gives the repository the account. */
  publishRepo(repo: string, input: PublishInput): Promise<Published>
```

3. In `METHODS`, after `listAccountRepos: true,`:

```ts
  listAccountWorkspaces: true,
  publishRepo: true,
```

In `src/main/ipc.ts`:

1. Add the import: `import { publishRepository } from './publish'` (next to `import { cloneWithAccount } from './clone'`).
2. After `listAccountRepos: (id) => accounts.listAccountRepos(id),`:

```ts
  listAccountWorkspaces: (id) => accounts.listAccountWorkspaces(id),
  publishRepo: (path, input) => publishRepository(path, input),
```

(The preload builds its methods from `API_METHODS`: nothing to add there.)

- [ ] **Step 7: Typecheck, run the account tests, commit**

Run: `npm run typecheck`
Expected: no errors.

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run tests/publishRepository.test.ts tests/cloneWithAccount.test.ts tests/commitIdentity.test.ts`
Expected: PASS.

```bash
npx prettier --write src/main/publish.ts src/main/accounts/index.ts src/shared/api.ts src/main/ipc.ts tests/publishRepository.test.ts
git add src/main/publish.ts src/main/accounts/index.ts src/shared/api.ts src/main/ipc.ts tests/publishRepository.test.ts
git commit -m "feat: publish a repository: create its project, add it as origin, bind the account"
```

---

### Task 4: The Publish repository dialog, opened by Push

**Files:**
- Modify: `src/renderer/src/store.ts` (`AppState` ~line 293, initial state ~line 324)
- Create: `src/renderer/src/components/PublishDialog.tsx`
- Modify: `src/renderer/src/actions.ts` (new functions after `addRemote` ~line 2552; `push()` ~line 1390)
- Modify: `src/renderer/src/App.tsx` (import, mount after `<RebaseDialog />` ~line 207)
- Modify: `src/renderer/src/i18n/en.ts`, `src/renderer/src/i18n/es.ts`
- Modify: `src/renderer/src/styles/app.css` (after `.rebase-problem` ~line 3135)
- Test: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: `api.publishRepo`, `api.listAccountWorkspaces` (Task 3); `canPublish`, `projectLocation`, `projectName`,
  `projectNameProblem`, `Published`, `PublishInput` (Task 1); existing `api.listAccounts()`, `api.getRepoAccount()`,
  `addRemote(path)`, `runOp`, `refreshRepo`, `loadPullRequests`, `toast`, `t`.
- Produces:
  - store: `publish: { path: string; resolve: (published: Published | null) => void } | null`
  - `usePublishChoice(accounts: Account[], nameFrom: string, preferred: string | null): PublishState`
  - `PublishFields({ publish, disabled }: { publish: PublishState; disabled?: boolean })`
  - `PublishDialog()` (no props)
  - actions: `publishRepository(path: string): Promise<Published | null>`, `closePublish(published: Published | null): void`,
    `openAccountsSettings(): void`, `afterPublish(path: string, published: Published): void`
  - i18n keys `publish.*`, `toast.published`, `toast.publishedEmpty`, `toast.publishNotBound`

- [ ] **Step 1: Write the failing end-to-end tests**

In `e2e/app.spec.ts`, after the test `'adds an account again with a new token: ...'`, add:

```ts
test('offers to publish a repository without remotes when pushing, or to add a remote by its URL', async () => {
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)

  await toolbarButton('Push').click()
  const dialog = page.locator('.publish-modal')
  await expect(dialog.locator('.modal-title')).toHaveText('Publish repository')
  await expect(dialog).toContainText('add a GitHub, GitLab, Bitbucket or Gitea account')
  await dialog.getByRole('button', { name: 'Add remote by URL' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.modal-title', { hasText: 'Add remote' })).toBeVisible()
})

test('an account without an API cannot publish a repository', async () => {
  test.skip(process.platform === 'linux' && !!process.env.CI, 'no keyring for the account token')
  const repo = box.repo('game', { 'a.txt': 'one\n' })
  await open(repo)

  await page.locator('.toolbar-right .icon-btn').click()
  await page.locator('.settings-nav-item', { hasText: 'Accounts' }).click()
  const section = page.locator('.settings-body:visible')
  await section.getByRole('button', { name: 'Add account' }).click()
  await section.locator('.account-form select').selectOption('other')
  await section.getByPlaceholder('Host').fill('git.example.com')
  await section.getByPlaceholder('Username').fill('ana')
  await section.getByPlaceholder('Personal access token').fill('a-token')
  await section.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.toasts')).toContainText('Account ana@git.example.com added')
  await page.keyboard.press('Escape')

  await toolbarButton('Push').click()
  const dialog = page.locator('.publish-modal')
  await expect(dialog).toContainText('add a GitHub, GitLab, Bitbucket or Gitea account')
  await dialog.getByRole('button', { name: 'Add account' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.settings-nav-item.active', { hasText: 'Accounts' })).toBeVisible()
})
```

If the Settings nav marks the shown section with another class than `active`, use what `SettingsModal.tsx` uses
(read it first: `grep -n "settings-nav-item" src/renderer/src/components/SettingsModal.tsx`).

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build; npx playwright test -c e2e/playwright.config.ts -g "publish"`
Expected: FAIL. The first test finds no `.publish-modal` (Push shows the "no remotes" error toast instead).

- [ ] **Step 3: Add the store state**

In `src/renderer/src/store.ts`:

1. Add the import: `import type { Published } from '../../shared/publish'`.
2. In `AppState`, after the `rebase` field:

```ts
  /** Publish repository dialog for repository `path`; `resolve` gets what was published (null: closed). */
  publish: { path: string; resolve: (published: Published | null) => void } | null
```

3. In the initial state, after `rebase: null,`: `publish: null,`

- [ ] **Step 4: Add the i18n keys and the style**

In `src/renderer/src/i18n/en.ts`, after `'init.submit': 'Create repository',`:

```ts
  'publish.title': 'Publish repository',
  'publish.hint': 'Creates the project on your account, adds it as origin and pushes the branch.',
  'publish.account': 'Account',
  'publish.workspace': 'Workspace',
  'publish.loadingWorkspaces': 'Loading workspaces…',
  'publish.noWorkspaces': 'This Bitbucket account has no workspace to create the repository in.',
  'publish.name': 'Name',
  'publish.location': 'Will be created at {where}',
  'publish.description': 'Description (optional)',
  'publish.private': 'Private',
  'publish.submit': 'Publish',
  'publish.publishing': 'Publishing…',
  'publish.noAccount':
    'This repository has no remote yet. To publish it, add a GitHub, GitLab, Bitbucket or Gitea account, or add a remote by its URL.',
  'publish.addAccount': 'Add account',
  'publish.addRemote': 'Add remote by URL',
  'publish.problem.empty': 'Type a name.',
  'publish.problem.tooLong': 'At most 100 characters.',
  'publish.problem.characters': 'Only letters, digits, ".", "-" and "_".',
  'publish.problem.dotGit': 'The name cannot end with ".git".',
  'publish.problem.edge': 'The name cannot start or end with "." or "-".',
  'toast.published': 'Published at {where}',
  'toast.publishedEmpty': 'Created {where}. Commit, then Push to upload it.',
  'toast.publishNotBound': 'Published, but the repository could not be given the account: {reason}',
```

and change `'accounts.bitbucketHint'` to:

```ts
  'accounts.bitbucketHint':
    'Create it with "Create API token with scopes", app Bitbucket, and these scopes: read:user, read:workspace, read:repository, write:repository, read:pullrequest and write:pullrequest (all ending in :bitbucket). To publish repositories from the app, admin:repository as well.',
```

In `src/renderer/src/i18n/es.ts`, after `'init.submit': ...`:

```ts
  'publish.title': 'Publicar repositorio',
  'publish.hint': 'Crea el proyecto en tu cuenta, lo añade como origin y sube la rama.',
  'publish.account': 'Cuenta',
  'publish.workspace': 'Workspace',
  'publish.loadingWorkspaces': 'Cargando workspaces…',
  'publish.noWorkspaces': 'Esta cuenta de Bitbucket no tiene ningún workspace donde crear el repositorio.',
  'publish.name': 'Nombre',
  'publish.location': 'Se creará en {where}',
  'publish.description': 'Descripción (opcional)',
  'publish.private': 'Privado',
  'publish.submit': 'Publicar',
  'publish.publishing': 'Publicando…',
  'publish.noAccount':
    'Este repositorio aún no tiene remoto. Para publicarlo, añade una cuenta de GitHub, GitLab, Bitbucket o Gitea, o añade un remoto por su URL.',
  'publish.addAccount': 'Añadir cuenta',
  'publish.addRemote': 'Añadir remoto por URL',
  'publish.problem.empty': 'Escribe un nombre.',
  'publish.problem.tooLong': 'Como mucho 100 caracteres.',
  'publish.problem.characters': 'Solo letras, números, ".", "-" y "_".',
  'publish.problem.dotGit': 'El nombre no puede terminar en ".git".',
  'publish.problem.edge': 'El nombre no puede empezar ni terminar con "." o "-".',
  'toast.published': 'Publicado en {where}',
  'toast.publishedEmpty': 'Creado {where}. Haz commit y luego Push para subirlo.',
  'toast.publishNotBound': 'Publicado, pero no se pudo asignar la cuenta al repositorio: {reason}',
```

and change `'accounts.bitbucketHint'` to:

```ts
  'accounts.bitbucketHint':
    'Créalo con "Create API token with scopes", app Bitbucket, y estos permisos: read:user, read:workspace, read:repository, write:repository, read:pullrequest y write:pullrequest (todos terminan en :bitbucket). Para publicar repositorios desde la app, también admin:repository.',
```

In `src/renderer/src/styles/app.css`, after the `.rebase-problem` rule:

```css
.publish-problem {
  color: var(--orange);
  font-size: 12px;
}
```

- [ ] **Step 5: Create `src/renderer/src/components/PublishDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import {
  canPublish,
  projectLocation,
  projectName,
  projectNameProblem,
  type ProjectNameProblem,
  type PublishInput
} from '../../../shared/publish'
import type { Account } from '../../../shared/types'
import { addRemote, closePublish, openAccountsSettings } from '../actions'
import { useT } from '../i18n'
import { useStore } from '../store'
import { errorMessage } from '../ui'
import { basename } from '../utils'
import { Spinner } from './common'

const api = window.leviathan

type Workspaces =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ready'; slugs: string[] }
  | { state: 'error'; message: string }

/** What the publish fields hold and what they make: `input` is null while something blocks Publish. */
export interface PublishState {
  usable: Account[]
  account: Account | null
  accountId: string
  setAccountId: (id: string) => void
  workspace: string
  setWorkspace: (slug: string) => void
  workspaces: Workspaces
  name: string
  setName: (name: string) => void
  nameProblem: ProjectNameProblem | null
  description: string
  setDescription: (text: string) => void
  isPrivate: boolean
  setPrivate: (value: boolean) => void
  input: PublishInput | null
}

/**
 * The choices of a publish: the accounts that can create projects (`preferred` first picked when it is one of them),
 * the workspace on Bitbucket, and a name that follows `nameFrom` (a folder) until it is edited.
 */
export function usePublishChoice(accounts: Account[], nameFrom: string, preferred: string | null): PublishState {
  const usable = accounts.filter(canPublish)
  const [picked, setAccountId] = useState('')
  const accountId = usable.some((a) => a.id === picked)
    ? picked
    : (usable.find((a) => a.id === preferred)?.id ?? usable[0]?.id ?? '')
  const account = usable.find((a) => a.id === accountId) ?? null
  const [workspaces, setWorkspaces] = useState<Workspaces>({ state: 'none' })
  const [pickedWorkspace, setWorkspace] = useState('')
  const [typedName, setTypedName] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [isPrivate, setPrivate] = useState(true)

  const bitbucket = account?.provider === 'bitbucket'
  useEffect(() => {
    if (!bitbucket) {
      setWorkspaces({ state: 'none' })
      return
    }
    let alive = true
    setWorkspaces({ state: 'loading' })
    api
      .listAccountWorkspaces(accountId)
      .then((slugs) => alive && setWorkspaces({ state: 'ready', slugs }))
      .catch((err) => alive && setWorkspaces({ state: 'error', message: errorMessage(err) }))
    return () => {
      alive = false
    }
  }, [accountId, bitbucket])

  const slugs = workspaces.state === 'ready' ? workspaces.slugs : []
  const workspace = slugs.includes(pickedWorkspace) ? pickedWorkspace : (slugs[0] ?? '')
  const name = typedName ?? projectName(nameFrom)
  const nameProblem = projectNameProblem(name.trim())
  const blocked = !account || nameProblem !== null || (bitbucket && !workspace)
  const input: PublishInput | null =
    blocked || !account
      ? null
      : {
          accountId: account.id,
          name: name.trim(),
          description: description.trim(),
          private: isPrivate,
          ...(bitbucket ? { workspace } : {})
        }
  return {
    usable,
    account,
    accountId,
    setAccountId,
    workspace,
    setWorkspace,
    workspaces,
    name,
    setName: setTypedName,
    nameProblem,
    description,
    setDescription,
    isPrivate,
    setPrivate,
    input
  }
}

/** Account, workspace (Bitbucket), name, description and private: the Publish dialog's and the Welcome form's. */
export function PublishFields({ publish, disabled }: { publish: PublishState; disabled?: boolean }) {
  const t = useT()
  const { account, workspaces } = publish
  const bitbucket = account?.provider === 'bitbucket'
  return (
    <>
      <label className="field">
        <span>{t('publish.account')}</span>
        <select value={publish.accountId} disabled={disabled} onChange={(e) => publish.setAccountId(e.target.value)}>
          {publish.usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.username}@{a.host}
            </option>
          ))}
        </select>
      </label>
      {bitbucket && workspaces.state === 'loading' && (
        <div className="dim small">
          <Spinner size={12} /> {t('publish.loadingWorkspaces')}
        </div>
      )}
      {bitbucket && workspaces.state === 'error' && <div className="publish-problem">{workspaces.message}</div>}
      {bitbucket && workspaces.state === 'ready' && workspaces.slugs.length === 0 && (
        <div className="publish-problem">{t('publish.noWorkspaces')}</div>
      )}
      {bitbucket && workspaces.state === 'ready' && workspaces.slugs.length > 1 && (
        <label className="field">
          <span>{t('publish.workspace')}</span>
          <select value={publish.workspace} disabled={disabled} onChange={(e) => publish.setWorkspace(e.target.value)}>
            {workspaces.slugs.map((slug) => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>{t('publish.name')}</span>
        <input
          value={publish.name}
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => publish.setName(e.target.value)}
        />
      </label>
      {publish.nameProblem ? (
        <div className="publish-problem">{t(`publish.problem.${publish.nameProblem}`)}</div>
      ) : (
        account && (
          <div className="dim small">
            {t('publish.location', { where: projectLocation(account, publish.workspace, publish.name.trim()) })}
          </div>
        )
      )}
      <label className="field">
        <span>{t('publish.description')}</span>
        <input
          value={publish.description}
          disabled={disabled}
          onChange={(e) => publish.setDescription(e.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={publish.isPrivate}
          disabled={disabled}
          onChange={(e) => publish.setPrivate(e.target.checked)}
        />
        {t('publish.private')}
      </label>
    </>
  )
}

export function PublishDialog() {
  const publish = useStore((s) => s.publish)
  if (!publish) return null
  return <PublishForm key={publish.path} path={publish.path} />
}

/** Publishes the repository at `path`; a refusal stays in the dialog, so the name can be changed and tried again. */
function PublishForm({ path }: { path: string }) {
  const t = useT()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [preferred, setPreferred] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([api.listAccounts().catch(() => []), api.getRepoAccount(path).catch(() => null)]).then(
      ([list, bound]) => {
        if (!alive) return
        setPreferred(bound)
        setAccounts(list)
      }
    )
    return () => {
      alive = false
    }
  }, [path])

  const publish = usePublishChoice(accounts ?? [], basename(path), preferred)
  const none = accounts !== null && publish.usable.length === 0
  const cancel = () => !running && closePublish(null)
  const submit = async () => {
    if (!publish.input || running) return
    setRunning(true)
    setError(null)
    try {
      closePublish(await api.publishRepo(path, publish.input))
    } catch (err) {
      setError(errorMessage(err))
      setRunning(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form
        className="modal publish-modal"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
      >
        <div className="modal-title">{t('publish.title')}</div>
        {accounts === null && <Spinner size={14} />}
        {none && <p className="modal-message">{t('publish.noAccount')}</p>}
        {accounts !== null && !none && (
          <>
            <p className="modal-message">{t('publish.hint')}</p>
            <PublishFields publish={publish} disabled={running} />
          </>
        )}
        {error && <div className="publish-problem">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" disabled={running} onClick={cancel}>
            {t('common.cancel')}
          </button>
          {none ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  closePublish(null)
                  void addRemote(path)
                }}
              >
                {t('publish.addRemote')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  closePublish(null)
                  openAccountsSettings()
                }}
              >
                {t('publish.addAccount')}
              </button>
            </>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!publish.input || running}>
              {running ? (
                <>
                  <Spinner size={12} /> {t('publish.publishing')}
                </>
              ) : (
                t('publish.submit')
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
```

If `Spinner` in `components/common.tsx` takes no `size` prop, check its signature
(`grep -n "export function Spinner" src/renderer/src/components/common.tsx`) and pass what it takes.

- [ ] **Step 6: Add the actions and open the dialog from `push()`**

In `src/renderer/src/actions.ts`:

1. Add the import: `import type { Published } from '../../shared/publish'`.
2. After the `addRemote` function, add:

```ts
/** Opens Publish repository for `path`; resolves with what was published, or null when it was closed. */
export function publishRepository(path: string): Promise<Published | null> {
  closePublish(null)
  return new Promise((resolve) => useStore.setState({ publish: { path, resolve } }))
}

/** Closes Publish repository, handing what was published (null: nothing) to whoever opened it. */
export function closePublish(published: Published | null): void {
  const open = useStore.getState().publish
  if (!open) return
  useStore.setState({ publish: null })
  open.resolve(published)
}

/** Settings → Accounts. */
export function openAccountsSettings(): void {
  useStore.setState({ settingsOpen: true, settingsSection: 'accounts', signInAgain: null })
}

/** After a repository was published: its new remote and pull requests shown, a failed account binding said. */
export function afterPublish(path: string, published: Published): void {
  if (published.bindError) toast('error', t('toast.publishNotBound', { reason: published.bindError }))
  void refreshRepo(path, { log: false })
  void loadPullRequests(path)
}

/**
 * Push in a repository without remotes: publishes it (the dialog), then pushes the branch, unless it has no commits
 * yet (`unborn`). `branch`: the branch pushed from its menu (undefined: the checked-out one).
 */
async function publishAndPush(path: string, branch: string | undefined, unborn: boolean): Promise<boolean> {
  const published = await publishRepository(path)
  if (!published) return false
  afterPublish(path, published)
  const where = `${published.host}/${published.fullName}`
  if (unborn) {
    toast('success', t('toast.publishedEmpty', { where }))
    return true
  }
  return runOp(path, () => api.push(path, { force: false, branch }), {
    busy: 'push',
    success: t('toast.published', { where })
  })
}
```

3. In `push()`, right after

```ts
  if (!branch) {
    toast('error', t('error.detachedPush'))
    return false
  }
```

add:

```ts
  // Nowhere to push yet: offer to create the project on an account (nothing to force, either).
  if (state && state.remotes.length === 0) return publishAndPush(path, opts.branch, !opts.branch && !state.head.hash)
```

- [ ] **Step 7: Mount the dialog**

In `src/renderer/src/App.tsx`, add `import { PublishDialog } from './components/PublishDialog'` next to the
`RebaseDialog` import, and `<PublishDialog />` right after `<RebaseDialog />`.

- [ ] **Step 8: Typecheck and run the end-to-end tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build; npx playwright test -c e2e/playwright.config.ts -g "publish"`
Expected: PASS, both tests.

- [ ] **Step 9: Run the whole unit suite**

Run (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
npx prettier --write src/renderer/src/components/PublishDialog.tsx src/renderer/src/actions.ts src/renderer/src/store.ts src/renderer/src/App.tsx src/renderer/src/i18n/en.ts src/renderer/src/i18n/es.ts src/renderer/src/styles/app.css e2e/app.spec.ts
git add src/renderer/src/components/PublishDialog.tsx src/renderer/src/actions.ts src/renderer/src/store.ts src/renderer/src/App.tsx src/renderer/src/i18n/en.ts src/renderer/src/i18n/es.ts src/renderer/src/styles/app.css e2e/app.spec.ts
git commit -m "feat: Push in a repository without remotes offers to publish it to an account"
```

---

### Task 5: Publish a new repository from the Welcome screen

**Files:**
- Modify: `src/renderer/src/components/WelcomeView.tsx` (`InitForm` ~line 253)
- Modify: `src/renderer/src/actions.ts` (`initRepository` ~line 721)
- Modify: `src/renderer/src/i18n/en.ts`, `es.ts`
- Test: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: `usePublishChoice`, `PublishFields` (Task 4); `afterPublish` (Task 4); `api.publishRepo` (Task 3);
  `PublishInput` (Task 1).
- Produces: `initRepository(path: string, branch: string, tabId: string, publish?: PublishInput): Promise<boolean>`;
  i18n keys `publish.alsoPublish`, `toast.publishFailed`.

- [ ] **Step 1: Write the failing end-to-end test**

In `e2e/app.spec.ts`, after the two tests of Task 4, add:

```ts
test('creates a repository from the Welcome screen, with no publish option without an account that has an API', async () => {
  await open()
  await page.locator('.welcome-card', { hasText: 'New repository' }).click()
  const form = page.locator('.welcome-form')
  await expect(form).toContainText('Initial branch')
  await expect(form.getByText('Also publish to an account')).toHaveCount(0)

  const folder = join(box.root, 'fresh')
  await form.locator('.field', { hasText: 'Folder' }).locator('input').fill(folder)
  await form.getByRole('button', { name: 'Create repository' }).click()
  await expect.poll(() => existsSync(join(folder, '.git'))).toBe(true)
})
```

`open()` with no repository starts on a Welcome tab (`launch` writes `openTabs: []`). If it shows something else,
check `App.tsx` for how a start with no tabs opens one, and click the new-tab button first.

- [ ] **Step 2: Run it**

Run: `npm run build; npx playwright test -c e2e/playwright.config.ts -g "Welcome screen"`
Expected: PASS already (there is no checkbox yet). It guards what Step 4 adds: the checkbox must stay hidden without
an account that has an API.

- [ ] **Step 3: Publish after `git init` in `initRepository`**

In `src/renderer/src/actions.ts`, add `PublishInput` to the publish import
(`import type { Published, PublishInput } from '../../shared/publish'`) and replace `initRepository` with:

```ts
/**
 * Creates a repository and opens it; with `publish`, then creates its project on the account and adds it as origin
 * (nothing to push yet). The repository comes first: a project left on the server by a failed init helps nobody.
 */
export async function initRepository(
  path: string,
  branch: string,
  tabId: string,
  publish?: PublishInput
): Promise<boolean> {
  let repo: string
  try {
    repo = await api.initRepo(path, branch)
    await openRepository(repo, tabId)
  } catch (err) {
    toast('error', errorMessage(err))
    return false
  }
  if (publish) {
    try {
      const published = await api.publishRepo(repo, publish)
      afterPublish(repo, published)
      toast('success', t('toast.publishedEmpty', { where: `${published.host}/${published.fullName}` }))
    } catch (err) {
      toast('error', t('toast.publishFailed', { reason: errorMessage(err) }))
    }
  }
  return true
}
```

- [ ] **Step 4: Add the checkbox and the fields to `InitForm`**

In `src/renderer/src/i18n/en.ts`, after `'publish.problem.edge': ...`:

```ts
  'publish.alsoPublish': 'Also publish to an account',
  'toast.publishFailed': 'The repository was created, but it could not be published: {reason}',
```

In `src/renderer/src/i18n/es.ts`, after `'publish.problem.edge': ...`:

```ts
  'publish.alsoPublish': 'Publicar también en una cuenta',
  'toast.publishFailed': 'Se creó el repositorio, pero no se pudo publicar: {reason}',
```

In `src/renderer/src/components/WelcomeView.tsx`, add the import
`import { PublishFields, usePublishChoice } from './PublishDialog'`, and replace `InitForm` with:

```tsx
function InitForm({ tabId, onBack }: { tabId: string; onBack: () => void }) {
  const t = useT()
  const [folder, setFolder] = useState('')
  const [branch, setBranch] = useState('main')
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [publishToo, setPublishToo] = useState(false)
  const publish = usePublishChoice(accounts, basename(folder.trim()), null)
  const canPublishAny = publish.usable.length > 0
  const publishing = canPublishAny && publishToo

  useEffect(() => {
    api
      .listAccounts()
      .then(setAccounts)
      .catch(() => {})
  }, [])

  return (
    <form
      className="welcome-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!folder.trim() || !branch.trim() || (publishing && !publish.input)) return
        setBusy(true)
        await initRepository(folder.trim(), branch.trim(), tabId, publishing ? (publish.input ?? undefined) : undefined)
        setBusy(false)
      }}
    >
      <FormTitle title={t('welcome.init')} onBack={onBack} />
      <label className="field">
        <span>{t('init.folder')}</span>
        <div className="input-row">
          <input autoFocus value={folder} spellCheck={false} onChange={(e) => setFolder(e.target.value)} />
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const dir = await api.pickFolder(t('init.folder'))
              if (dir) setFolder(dir)
            }}
          >
            {t('clone.browse')}
          </button>
        </div>
      </label>
      <label className="field">
        <span>{t('init.branch')}</span>
        <input value={branch} spellCheck={false} onChange={(e) => setBranch(e.target.value)} />
      </label>
      {canPublishAny && (
        <label className="checkbox">
          <input type="checkbox" checked={publishToo} onChange={(e) => setPublishToo(e.target.checked)} />
          {t('publish.alsoPublish')}
        </label>
      )}
      {publishing && <PublishFields publish={publish} disabled={busy} />}
      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !folder.trim() || !branch.trim() || (publishing && !publish.input)}
        >
          {t('init.submit')}
        </button>
      </div>
    </form>
  )
}
```

(`Account` is already imported in `WelcomeView.tsx`; `basename` too, from `'../utils'`.)

- [ ] **Step 5: Typecheck and run the end-to-end tests again**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build; npx playwright test -c e2e/playwright.config.ts -g "Welcome screen|publish"`
Expected: PASS, three tests.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/renderer/src/components/WelcomeView.tsx src/renderer/src/actions.ts src/renderer/src/i18n/en.ts src/renderer/src/i18n/es.ts e2e/app.spec.ts
git add src/renderer/src/components/WelcomeView.tsx src/renderer/src/actions.ts src/renderer/src/i18n/en.ts src/renderer/src/i18n/es.ts e2e/app.spec.ts
git commit -m "feat: publish a new repository to an account from the Welcome screen"
```

---

### Task 6: Documentation, full verification, real check

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`), `README.md` (features list ~line 42-46 and the Spanish list ~line 147),
  `docs/STATUS.md` (`## Accounts` section), `docs/ROADMAP.md` (`## Remotes and collaboration`)

- [ ] **Step 1: Document it**

`CHANGELOG.md`, under `## [Unreleased]`:

```markdown
### Added

- **A repository made on this computer can be published to your account**: Push in a repository with no remotes opens
  *Publish repository*, which creates the project on one of your GitHub, GitLab, Bitbucket or Gitea accounts (private
  by default; on Bitbucket, in one of your workspaces), adds it as `origin` and pushes the branch. *New repository* on
  the Welcome screen can create the project too, with *Also publish to an account*. A name already taken, or a token
  without the permission, is said in the dialog, which stays open to try another name. Bitbucket API tokens need
  `admin:repository` to create repositories.
```

`README.md`: after the `**Pull requests**` bullet (~line 46) add

```markdown
- **Publish** a repository made on this computer to your GitHub, GitLab, Bitbucket or Gitea account: Push creates the project, adds it as `origin` and pushes, with no trip to the website.
```

and in the Spanish list, after the pull requests line (~line 147):

```markdown
- Publicar un repositorio creado en este equipo en tu cuenta de GitHub, GitLab, Bitbucket o Gitea: Push crea el proyecto, lo añade como `origin` y sube la rama.
```

`docs/STATUS.md`, at the end of the `## Accounts` section, a bullet in the style of that section:

```markdown
- Publish repository (2026-11-22): Push in a repository without remotes, or *Also publish to an account* in New
  repository, creates the project on the user's account through the API (`createProject` in
  `src/main/accounts/providers.ts`, `src/main/publish.ts`), adds it as `origin` and binds the repository to the
  account (keeping an identity of its own). User only, no organisations; HTTPS remote. Bitbucket needs
  `admin:repository:bitbucket`.
```

`docs/ROADMAP.md`, in `## Remotes and collaboration`, add:

```markdown
- [x] Publish a local repository to an account (create the project, add it as origin, push)
```

- [ ] **Step 2: Full verification**

Run each, and read the output before going on:

```bash
npm run typecheck
npm run format:check
npm run build
npx playwright test -c e2e/playwright.config.ts -g "publish|Welcome screen|Add remote|account"
```

and (PowerShell): `Set-Location D:\REPOS\Leviathan; npx vitest run`

Expected: all pass. `format:check` fails → `npx prettier --write <file>` on the files it names, then re-run.

- [ ] **Step 3: Commit the docs**

```bash
git add CHANGELOG.md README.md docs/STATUS.md docs/ROADMAP.md
git commit -m "docs: publishing a local repository to an account"
```

- [ ] **Step 4: Real check (ask the user first: it creates a project on their account)**

Ask the user before doing this. Then, with the built app (`npm run build`, launched through Playwright as in
`e2e/app.ts` with a scratch `LEVIATHAN_USER_DATA`, or the user's own run of `npm run dev`):

1. Make a scratch repository with one commit in the scratchpad directory.
2. Open it, sign in to the user's GitHub account in Settings → Accounts (or use the account they already have, in
   their own profile), press Push.
3. In *Publish repository*: the account preselected, the name from the folder, *Will be created at
   github.com/<user>/<name>*, Private checked. Publish.
4. Expect the toast *Published at github.com/<user>/<name>*, `origin` in the REMOTE section, the branch with its
   upstream, and the private project with the commit on GitHub.
5. Press Publish again in another scratch repository with the same name: the dialog stays open with
   *GitHub answered with an error (422): name already exists on this account*.
6. Tell the user which scratch projects were created, so they can delete them (deleting needs the `delete_repo` scope,
   which the app's token does not have).
