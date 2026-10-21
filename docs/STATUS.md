# Development status

Snapshot of where Leviathan stands and what comes next, so a new working session can pick up without digging through history. Last updated: 2026-10-21, at `main` = `9b3965b` (CI green on Windows, macOS and Linux, 213 tests).

For long-term ideas see [ROADMAP.md](ROADMAP.md); for user-facing changes see [CHANGELOG.md](../CHANGELOG.md).

## Released

| Version | Date | Highlights |
|---|---|---|
| 0.1.0 | 2026-10-21 | Graph, staging (files, hunks, lines), commit, branches, merge/rebase, pull/push, stash, tags, clone/init |
| 0.2.0 | 2026-10-21 | Accounts (encrypted tokens, per-repo identity and HTTPS auth), fetch button, branch start point, branch dates |

Both are published as pre-releases on GitHub. The 0.2.0 release has no Linux installers: the three build jobs ran in parallel and the Linux one most likely uploaded to a second draft release. The release workflow is fixed (see below), but 0.2.0 itself was left as it is.

## Done since 0.2.0 (on `main`, not released yet)

All of these went through a final whole-branch review; Critical and Important findings were fixed with a failing test first.

- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z): commits, amends, checkouts, branch and tag changes, merges, rebases, cherry-picks, reverts, resets, pulls. It refuses to undo while an operation is in progress, keeps branch settings (upstream) when branches are deleted, created or renamed, and undoing a merge commit brings the merge back. Code: `src/shared/undo.ts`, `applyChange` / `getSnapshot` in `src/main/git/repository.ts`, `src/renderer/src/undoStack.ts`.
- **Conflict editor**: current and incoming versions side by side, choices per block or the whole file (including deletions and submodules). Files over 2 MB or not in UTF-8 can only take a side, and a save is refused if the file changed since it was opened. Code: `src/shared/conflicts.ts`, `components/ConflictView.tsx`.
- **Interactive rebase**: right-click a commit → reorder, reword, squash, fixup, drop. No editor is ever opened; the todo list and messages are prepared in `<gitdir>/leviathan-rebase/` and applied with `GIT_SEQUENCE_EDITOR=cp`. Code: `src/shared/rebase.ts`, `interactiveRebase` in `repository.ts`, `components/RebaseDialog.tsx`.
- **Pull requests** (GitHub, GitLab, Gitea) through the stored accounts: a side-panel section listing open PRs (click shows the branch, double-click checks it out, menu opens it in the browser), and "Create pull request…" on a branch, which pushes first when needed. GitLab tokens need the `api` scope. Code: `src/shared/forge.ts`, `src/main/accounts/providers.ts`, `src/main/accounts/index.ts`, `checkoutPullRequest` in `repository.ts`.
- **Pull a branch that is not checked out** (branch menu → *Pull … (fast-forward)*); the toast after a pull names the branch and says when it was already up to date, and the graph scrolls to the new tip.
- **Unpushed commits** show a small ↑ at the end of their message in the graph.
- **New app icon** (`resources/icon.png`, `src/renderer/public/leviathan.png`).
- **Release workflow**: a first job creates one draft release, and the three builds upload to it.

## Next steps

### 1. Try the unreleased work with a real account

Pull requests were tested against a mocked API only. With a GitHub account added in Settings, on a repository whose `origin` is on GitHub, check:

- [ ] the "Pull requests" section lists the open PRs;
- [ ] right-click a branch → *Create pull request…* creates it and opens it in the browser;
- [ ] double-click a PR checks it out (a fork's PR becomes `pr/N`);
- [ ] a GitLab account with an `api`-scope token does the same with merge requests.

Also worth a pass on a real repository: undo after commit/checkout/branch delete, a merge conflict resolved in the editor, an interactive rebase that is then undone.

### 2. Release 0.3.0

1. Set `"version": "0.3.0"` in `package.json`.
2. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [0.3.0] - <date>` and add an empty `[Unreleased]` above it.
3. Commit, then tag and push: `git tag v0.3.0 && git push origin main v0.3.0`.
4. Watch the Release workflow: this is the first run of the fixed workflow. There must be **one** draft release with the Windows (`setup.exe`, `portable.exe`), macOS (`dmg`, `zip`) and Linux (`AppImage`, `deb`) files and the three `latest*.yml`.
5. Publish the draft on GitHub (keep or drop "pre-release").

### 3. Sign in with the browser (OAuth device flow)

Last of the planned big features: log in to GitHub / GitLab from the browser instead of pasting a personal access token. It needs, from the maintainer:

- a GitHub **OAuth App** (Settings → Developer settings → OAuth Apps) with *Device flow* enabled, and its **client ID** (public; no secret is needed for the device flow);
- for GitLab, an **application** with the `api`, `read_user` and `write_repository` scopes, and its application ID.

The flow plugs into the existing account store: the token obtained replaces the pasted one, and everything else (askpass, per-repo binding, pull requests) works unchanged.

### 4. Small decisions pending

- Add a Windows `.zip` target (unpack once, starts faster than the portable `.exe`, which unpacks itself on every launch).
- Optionally bring the UI accent colour (teal) closer to the blue of the new icon.

## Known minor issues

Found by reviews and left for later; none loses work. Good first contributions.

**Undo / redo**
- Applying a change is not atomic (could use `update-ref --stdin`), and there is no guard against two undos at once.
- Tags fetched in the background end up in the next recorded change.
- The redo error message says "undone" and is not translated.
- The first commit of an empty repository cannot be undone.
- Some actions are not recorded (stash, discard…).
- Undoing a branch rename restarts its reflog; undoing a merge commit does not restore `MERGE_MODE` (`--no-ff`).

**Conflict editor**
- `=======` inside the current side is read as the separator (git and other editors share this ambiguity).
- Whole-file buttons discard manual edits of the working file without asking.
- A file deleted on both sides shows a raw `ENOENT` error (the buttons still work).
- No line limit: up to 2 MB is rendered as one element per line.

**Interactive rebase**
- The dialog closes when the rebase is refused (for example, uncommitted changes) and typed messages are lost.
- Esc closes the dialog while it runs, and app shortcuts (Ctrl+W, Ctrl+Z, Ctrl+Tab) act behind it.
- The conflict toast shows git's raw output, including the internal `exec` line.
- A rebase that stopped for a conflict and was continued is not undoable.
- `.git/leviathan-rebase/` stays after success.
- If the commit a squash group melds into ends up empty, the squashed messages are not merged into the previous commit.

**Pull requests**
- The list is not reloaded after adding or removing accounts or remotes until the next fetch.
- A token that can no longer be decrypted hides the section without a hint.
- 401/403 messages are generic (no Gitea scope; expired token vs. missing scope).
- Rows show `#N title author`; `source → target` is only in the tooltip.
- More than 50 open PRs are not paginated; fork workflows (origin = personal fork) list the fork's PRs, not the parent's.
- A local branch named `pr` blocks `pr/N`.

**Accounts**
- Usernames with `%` or `@` in the askpass prompt; `*.ghe.com` API base and no-reply emails for hosts with a port.
- Nested repositories match the first registered repository, not the deepest; Windows path casing in the repository → account map.
- A clone that succeeds but fails to bind to the account is reported as a failed clone.
- The same account can be added twice; `other` accounts get an invented default email.

**Older items**
- Background fetch does not mark the repository busy, so a manual pull at the same moment can hit "cannot lock ref".
- Checkout-and-merge from drag and drop has no confirmation.
- The SSH key passphrase is passed on the command line when generating a key.
- "Ignore file" does not escape glob characters.
- Pushing with `--set-upstream` replaces a deliberately different upstream.
- The locale test does nothing without a translated git.

## Working on it

```bash
npm ci
npm run dev          # app with hot reload
npm test             # vitest, real git repositories in temp folders
npm run typecheck
npm run format:check
npm run dist:win     # installers in dist/ (also dist:mac, dist:linux)
```

- From a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` before launching Electron (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
- A test build that can't be mistaken for a release: `npx electron-builder --win -c.extraMetadata.version=0.3.0-dev --publish never` (after `npm run build`). Close any Leviathan running from `dist/` first, or the build can't overwrite its files.
- Features are built test-first; every git operation has integration tests against real repositories, and UI changes are checked by driving the built app with Playwright's Electron support.
