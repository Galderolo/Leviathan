# Publish a local repository to an account

Date: 2026-11-22. Status: implemented (branch feat/publish-repository).

## Goal

A repository made on this computer (`git init`, by hand or by a tool) has no project on any server, so Push can only
fail ("This repository has no remotes"). Leviathan creates the project on one of the user's accounts through the
provider's API, adds it as `origin` and pushes, in one dialog: no trip to the website, no URL to copy.

Providers: every one Leviathan already talks to for pull requests (GitHub and GitHub Enterprise, GitLab.com and
self-managed GitLab, Bitbucket Cloud, Gitea). "Other" accounts have no API and cannot publish.

Out of scope for v1: organisations and groups as owners (the project goes to the user; on Bitbucket, to one of the
user's workspaces, since Bitbucket has no projects outside a workspace), SSH remote URLs (HTTPS works with the account
token at once), publishing a repository that already has remotes, a "publish" entry in the REMOTE section.

## What the user sees

### Push in a repository without remotes

Any push of a branch (toolbar Push and its shortcut, a branch's menu) in a repository with no remotes opens the
**Publish repository** dialog instead of failing. Pushing after a commit (the repository setting) only runs when
there is a remote, so it never opens the dialog. The check comes right after the "no branch" check and before the
force-push confirmation.

Fields:

- **Account**: the accounts with an API (provider not `other`), shown `username@host`. Preselected: the account the
  repository is bound to, when it qualifies; otherwise the first.
- **Workspace**: Bitbucket only, the workspaces of the account (`/user/workspaces`). Loaded when the account changes;
  hidden when there is only one (that one is used). A failure to load shows inline and blocks Publish.
- **Name**: `projectName(folder name)` (see Shared). A problem with what is typed shows inline and blocks Publish. Under
  it, where the project will be: `github.com/<username>/<name>` (Bitbucket: `bitbucket.org/<workspace>/<slug>`).
- **Description**: optional, one line.
- **Private**: checked by default.

Buttons: Cancel, **Publish**. While publishing, Publish is disabled with a spinner ("Publishing…"). A refusal from the
server (name taken, missing permission) shows inline in the dialog, which stays open so the name can be changed and
Publish pressed again.

Without any account that has an API, the dialog says so ("To publish, add a GitHub, GitLab, Bitbucket or Gitea
account") and offers **Add account** (opens Settings → Accounts), **Add remote by URL** (today's Add remote dialog) and
Cancel.

After the project is created the dialog closes, the repository is read again (its new remote shows) and:

- the branch has commits: it is pushed with the normal push (progress, `--set-upstream`). One toast at the end:
  "Published at github.com/ana/game";
- the branch has no commits yet (unborn): nothing is pushed. Toast: "Created github.com/ana/game. Commit, then Push to
  upload it."

A push that fails after the project was created leaves the project and `origin` in place: the error is the usual push
error, and the next Push is an ordinary one.

### Welcome → Create repository

A checkbox **Also publish to an account**, shown only when there is at least one account with an API. Checked, it shows
the same fields as the dialog (account, workspace, name, description, private). The name follows the folder's name as
it is typed or picked, until the user edits the name.

On Create: `git init` first, then the project is created and added as `origin`; nothing is pushed (there are no
commits). Toast as for an unborn branch. If publishing fails, the new repository stays open with an error toast; Push
offers the dialog again later.

The local repository comes first on purpose: a project created on the server and then a failed `git init` would leave
an empty project behind.

## Shared

New module `src/shared/publish.ts`:

- `projectName(folder)`: the folder name trimmed; every run of characters outside `[A-Za-z0-9._-]` becomes one `-`;
  leading and trailing `-` and `.` dropped; a trailing `.git` dropped; at most 100 characters. May return `''`.
- `projectNameProblem(name)`: `null` when the name can be used, else a reason the renderer translates: `empty`,
  `tooLong` (over 100), `characters` (outside `[A-Za-z0-9._-]`), `dotGit` (ends with `.git`), `edge` (starts or ends
  with `-` or `.`).
- `bitbucketSlug(name)`: `name` in lower case (Bitbucket's slug rules are those of `projectName`, lower-cased).
- Types `NewProject` (`name`, `description`, `private`, `branch`, `workspace?`), `CreatedProject` (`fullName`,
  `cloneUrl`, `webUrl`), `PublishInput` (`accountId`, `name`, `description`, `private`, `workspace?`), `Published`
  (`fullName`, `webUrl`, `host`, `bindError: string | null`). `shared/types.ts` if that is where the other API types
  live.

## Main process

### `providers.ts`

`createProject(provider, host, token, input: NewProject, fetchFn = fetch): Promise<CreatedProject>`:

| Provider  | Request                                                                                                      | Answer used                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| GitHub    | `POST /user/repos` `{ name, description, private, auto_init: false }`                                         | `full_name`, `clone_url`, `html_url`             |
| Gitea     | `POST /user/repos` `{ name, description, private, auto_init: false, default_branch: branch }`                 | `full_name`, `clone_url`, `html_url`             |
| GitLab    | `POST /projects` `{ name, path: name, description, visibility: private ? 'private' : 'public' }`             | `path_with_namespace`, `http_url_to_repo`, `web_url` |
| Bitbucket | `POST /repositories/{workspace}/{bitbucketSlug(name)}` `{ scm: 'git', name, description, is_private }`        | `full_name`, `links.html.href`                   |

- Bitbucket's clone URL is built as `https://<host>/<full_name>.git`, without the username Bitbucket puts in its own
  link (as `bitbucketRepos` already does: git would use that username over the account bound to the repository).
- Gitea gets `default_branch` explicitly: whether its first push sets the default branch of an empty repository is not
  certain across versions.
- `workspace` is required for Bitbucket (an error otherwise) and ignored by the others.
- An answer without the fields above is an error ("<Provider> answered without the new project's address"), not a
  remote with `undefined` in it.

`bitbucketWorkspaces(host, token, fetchFn)`: the workspace slugs of `/user/workspaces?pagelen=100`, the code
`bitbucketRepos` has today, moved out so both use it.

Error texts in `request()`:

- `reason()` also reads GitLab's validation errors, where `message` is an object of field → list:
  `{ name: ['has already been taken'], path: ['has already been taken'] }` becomes
  `name has already been taken, path has already been taken` (today it would print `[object Object]`).
- The 401/403 explanation names the permission of the change asked. Today it always speaks of pull requests; a
  creation says "permission to create repositories (GitHub: repo, GitLab: api, Bitbucket: admin:repository:bitbucket)".
  `request()` takes that text as an option of the change (`send.need`), pull requests remaining the default. Bitbucket's
  403 already names what it lacks from `error.detail.required`; Gitea's message names its scope and is passed through.
- The Bitbucket token hint (`accounts.bitbucketHint`, en and es) adds `admin:repository` to the permissions to pick.
  To check against Atlassian's reference for "Create a repository" while implementing; if it names another scope,
  that one goes in both the hint and the 403 text.

### `accounts/index.ts`

`listAccountWorkspaces(accountId): Promise<string[]>`: Bitbucket accounts, their workspaces; others `[]`.

`publishRepository(repo, input: PublishInput): Promise<Published>`:

1. Checks the input (strings and a boolean; `projectNameProblem(name) === null`; the account exists and has an API;
   Bitbucket: `workspace` given). Throws on anything else.
2. Refuses a repository that already has a remote named `origin`, before asking the server anything.
3. Reads the current branch name, also on an unborn branch (`symbolic-ref --short HEAD`), for Gitea's
   `default_branch`.
4. `createProject` with the account's fresh token. A failure here throws as it is: nothing local was changed.
5. `addRemote(repo, 'origin', cloneUrl)`. If that fails, throws "The project was created at <webUrl>, but it could not
   be added as origin: <git's error>. Add it with Add remote." (the project exists; the user must know).
6. Binds the repository to the account (its HTTPS credentials pinned to that account, so a credential stored by
   another helper or another account of the same host is not used for the push). A repository with an identity of its
   own keeps it: `setRepoAccount(repo, id, { keepIdentity: true })` when `readIdentity(repo).local` has a name or an
   email; otherwise the account's identity is written, as `ensureDefaultIdentity` does when a repository owned by an
   account is opened. A failure to bind does not undo anything: it is returned as `bindError` and the renderer shows
   it as a warning, as `cloneWithAccount` does.
7. Returns `{ fullName, webUrl, host, bindError }`.

`setRepoAccount(repo, accountId, opts?: { keepIdentity?: boolean })`: with `keepIdentity`, skips `applyIdentity`;
everything else as today. `commitIdentity` already reports such a repository as having an identity of its own.

### IPC

`publishRepo(path, input)` and `listAccountWorkspaces(accountId)` in `shared/api.ts` (types and the allow list),
`ipc.ts` and the preload, next to `listAccountRepos`.

## Renderer

- `components/PublishDialog.tsx`:
  - `PublishFields`: the controlled fields (account, workspace, name with its problem and where-it-goes line,
    description, private), loading the workspaces when a Bitbucket account is picked. Used by the dialog and by the
    Welcome form.
  - `PublishDialog`: the modal around them, mounted in `App.tsx` like `RebaseDialog`, open while the store holds
    `publish: { path, branch } | null`. It calls `api.publishRepo` itself, so a refusal stays in the dialog.
- `actions.ts`:
  - `publishRepository(path, branch): Promise<Published | null>` opens the dialog and resolves when it closes (null:
    cancelled).
  - `push()`: when the state has no remotes, calls `publishAndPush(path, branch)`: publishes, reloads the repository,
    then pushes with the existing push call, its success toast replaced by "Published at …"; on an unborn branch, no
    push and the "Created …" toast. A `bindError` is a warning toast.
  - `initRepository(path, branch, tabId, publish?: PublishInput)`: after opening the repository, publishes when asked
    (no push), with the same toasts.
- `WelcomeView.tsx` `InitForm`: the checkbox and `PublishFields`, the accounts listed once on mount (as `CloneForm`
  does).
- i18n keys in `en.ts` and `es.ts`: dialog title, field labels, the name problems, the no-account message and its two
  buttons, Publishing…, the two toasts, the checkbox, the bind warning.

## Errors, in short

| What fails                         | State left                                        | What the user sees                         |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Server refuses the creation        | Nothing changed                                   | Reason inline in the dialog, still open    |
| `origin` cannot be added           | Project on the server, repository unchanged       | Error naming the project's address         |
| Binding to the account             | Project and `origin` in place                     | Warning toast; push still tried            |
| Push after publishing              | Project and `origin` in place                     | The usual push error; next Push is normal  |
| Publish after Welcome's `git init` | Repository created and open, no `origin`          | Error toast; Push offers the dialog again  |

## Tests

Unit (vitest):

- `createProject` for each provider with a fake `fetchFn`: method, path and body sent; the answer mapped (Bitbucket's
  clone URL without a username); GitHub's 422 "name already exists on this account", GitLab's 400 with the field
  object, Gitea's 409, Bitbucket's 403 with `required` scopes; an answer without the address fields.
- `reason()` with GitLab's validation object.
- `projectName`, `projectNameProblem` and `bitbucketSlug`: spaces, accents, symbols, dots and dashes at the edges,
  `.git`, length.
- `publishRepository` with a real repository and `providers` mocked so the "created" project's `cloneUrl` is a local
  bare repository: `origin` added with that URL, the account bound, a repository's own identity kept, refusal when
  `origin` exists (nothing asked to the server), the server's refusal leaving no remote, `addRemote` failing naming
  the project's address.
- `remotesToChooseFrom` and `push` paths untouched for repositories with remotes (existing tests keep passing).

End to end (Playwright):

- Push in a repository without remotes and without accounts opens Publish repository with the no-account message;
  Add remote by URL opens the Add remote dialog.
- With only an "Other" account, the same message (it has no API).
- Welcome → Create repository: no publish checkbox without an account that has an API.

Real check at the end, with the user's permission first (it creates a project on their account): publish a scratch
repository to their GitHub account from the built app, private, and see it pushed.
