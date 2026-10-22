# Development status

Snapshot of where Leviathan stands and what comes next, so a new working session can pick up without digging through history. Last updated: 2026-10-22, with 0.4.0 released (267 tests). Work goes on `feat/…` / `fix/…` branches pushed to GitHub and merged into `main` with a merge commit.

For long-term ideas see [ROADMAP.md](ROADMAP.md); for user-facing changes see [CHANGELOG.md](../CHANGELOG.md).

## Released

| Version | Date | Highlights |
|---|---|---|
| 0.1.0 | 2026-10-21 | Graph, staging (files, hunks, lines), commit, branches, merge/rebase, pull/push, stash, tags, clone/init |
| 0.2.0 | 2026-10-21 | Accounts (encrypted tokens, per-repo identity and HTTPS auth), fetch button, branch start point, branch dates |
| 0.3.0 | 2026-10-21 | Undo/redo, conflict editor, interactive rebase, pull requests, pull without checkout, unpushed-commit marks, new icon (no macOS installers) |
| 0.3.1 | 2026-10-22 | Same app as 0.3.0, with the macOS installers |
| 0.4.0 | 2026-10-22 | Sign in with GitHub, multi-file selection, close pull requests, file history and blame, word highlights and side-by-side diffs |

All are published as pre-releases on GitHub. The 0.2.0 release has no Linux installers: the three build jobs ran in parallel and the Linux one most likely uploaded to a second draft release. The 0.3.0 release has no macOS installers: it was published while the macOS build was still waiting for a runner, and that build only uploaded into drafts. Since 0.3.1 the builds keep their installers as artifacts and a last job uploads them all and publishes, whatever the state of the release.

## Done in 0.3.0

All of these went through a final whole-branch review; Critical and Important findings were fixed with a failing test first.

- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z): commits, amends, checkouts, branch and tag changes, merges, rebases, cherry-picks, reverts, resets, pulls. It refuses to undo while an operation is in progress, keeps branch settings (upstream) when branches are deleted, created or renamed, and undoing a merge commit brings the merge back. Code: `src/shared/undo.ts`, `applyChange` / `getSnapshot` in `src/main/git/repository.ts`, `src/renderer/src/undoStack.ts`.
- **Conflict editor**: current and incoming versions side by side, choices per block or the whole file (including deletions and submodules). Files over 2 MB or not in UTF-8 can only take a side, and a save is refused if the file changed since it was opened. Code: `src/shared/conflicts.ts`, `components/ConflictView.tsx`.
- **Interactive rebase**: right-click a commit → reorder, reword, squash, fixup, drop. No editor is ever opened; the todo list and messages are prepared in `<gitdir>/leviathan-rebase/` and applied with `GIT_SEQUENCE_EDITOR=cp`. Code: `src/shared/rebase.ts`, `interactiveRebase` in `repository.ts`, `components/RebaseDialog.tsx`.
- **Pull requests** (GitHub, GitLab, Gitea) through the stored accounts: a side-panel section listing open PRs (click shows the branch, double-click checks it out, menu opens it in the browser), and "Create pull request…" on a branch, which pushes first when needed. GitLab tokens need the `api` scope. Code: `src/shared/forge.ts`, `src/main/accounts/providers.ts`, `src/main/accounts/index.ts`, `checkoutPullRequest` in `repository.ts`.
- **Pull a branch that is not checked out** (branch menu → *Pull … (fast-forward)*); the toast after a pull names the branch and says when it was already up to date, and the graph scrolls to the new tip.
- **Unpushed commits** show a small ↑ at the end of their message in the graph.
- **New app icon** (`resources/icon.png`, `src/renderer/public/leviathan.png`).
- **Release workflow**: a first job creates a draft with the CHANGELOG notes, the three builds keep their installers as artifacts, and a last job uploads them and publishes the release (0.3.1).

## Next steps

### 1. Keep an eye on 0.3.0

Pull requests were tested for real on a private GitHub repository (create as draft, list, check out by double-click). Still untested with a real server: GitLab merge requests and Gitea. Note that deleting a pull request's branch does not close it on GitHub; there is no "close pull request" action in the app yet.

### 2. Releasing the next version

1. Set the version in `package.json` (and `package-lock.json`).
2. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z] - <date>` and add an empty `[Unreleased]` above it.
3. Commit, then tag and push: `git tag vx.y.z && git push origin main vx.y.z`.
4. The Release workflow builds Windows, macOS and Linux and, when all three succeed, uploads the installers and publishes the release as a pre-release. There is nothing to click: publishing the draft by hand earlier is harmless, the upload still happens. If a build fails, the release stays an empty draft: fix, delete the draft and the tag, and tag again.

### 3. Sign in with the browser

Done for GitHub (unreleased): Settings → Accounts → *Sign in with GitHub* runs the OAuth device flow with the project's OAuth App (client ID in `src/shared/providers.ts`, scopes `repo read:user`); the token goes straight into the encrypted account store. Code: `src/main/accounts/oauth.ts`, `startGitHubLogin` / `finishGitHubLogin` in `src/main/accounts/index.ts`.

Still to do: GitLab (needs an *application* on gitlab.com with the `api`, `read_user` and `write_repository` scopes, and its application ID) and GitHub Enterprise (each server needs its own OAuth App).

### 4. Small decisions pending

- Add a Windows `.zip` target (unpack once, starts faster than the portable `.exe`, which unpacks itself on every launch).
- Optionally bring the UI accent colour (teal) closer to the blue of the new icon.

## Known minor issues

Found by reviews and left for later; none loses work. Good first contributions.

**Undo / redo**
- Applying a change is not atomic (could use `update-ref --stdin`), and there is no guard against two undos at once.
- Tags fetched in the background end up in the next recorded change.
- The first commit of an empty repository cannot be undone.
- Some actions are not recorded (stash, discard…).
- Undoing a branch rename restarts its reflog; undoing a merge commit does not restore `MERGE_MODE` (`--no-ff`).

**Conflict editor**
- `=======` inside the current side is read as the separator (git and other editors share this ambiguity).
- Whole-file buttons discard manual edits of the working file without asking.
- A file deleted on both sides shows a raw `ENOENT` error (the buttons still work).
- No line limit: up to 2 MB is rendered as one element per line.

**Interactive rebase**
- When a rebase stops for something other than conflicts (an untracked file in the way, a failed step), the message still says "usually for conflicts" and drops git's reason.
- A rebase that stopped for a conflict and was continued is not undoable.
- If the commit a squash group melds into ends up empty, the squashed messages are not merged into the previous commit.

**Pull requests**
- A 403 when closing a pull request always blames the token's scopes, even when the account lacks the role on the project.
- A token that can no longer be decrypted hides the section without a hint.
- 401/403 messages are generic (no Gitea scope; expired token vs. missing scope).
- More than 50 open PRs are not paginated; fork workflows (origin = personal fork) list the fork's PRs, not the parent's.
- A local branch named `pr` blocks `pr/N`.

**Accounts**
- Usernames with `%` or `@` in the askpass prompt; `*.ghe.com` API base and no-reply emails for hosts with a port.
- Nested repositories match the first registered repository, not the deepest; Windows path casing in the repository → account map.
- A clone that succeeds but fails to bind to the account is reported as a failed clone.
- `other` accounts get an invented default email.
- GitHub sign-in: one network error while waiting ends the sign-in (no retry); no local deadline besides GitHub's `expired_token`; secure storage is only checked after the browser step; a cancel pressed after GitHub issued the token still adds the account.
- Adding by token an account that already exists renews its token but ignores a name/email typed in the form, and the toast says "added".

**Multi-file selection**
- Shift+click on a checkbox only adds the range; a range cannot be unchecked that way.
- The divider: no keyboard support, a right-button press also drags, every move re-renders the panel (may stutter with huge lists).
- Checked rows lose the hover highlight; in Spanish at the minimum panel width the header buttons can crowd the title.
- Checkboxes in the staged list do not exclude files from the commit (unlike GitHub Desktop); "Quitar selección" can read as "deselect".

**Diffs**
- An open conflict view is not closed when the file stops being conflicted (marked resolved from the list, or after Abort).
- An open diff keeps an outdated untracked flag when the file stays in the same list (`git rm --cached`).

**File history and blame**
- File names with quotes, backslashes or tabs (Linux/macOS) come back quoted from `git log` (no `-z`), so their diff is empty.
- History of a staged rename starts from the new name, which HEAD does not have yet (empty list).
- A pure rename shows "No changes" with no "renamed from" note in the diff pane.
- History stops at 300 commits and blame at 20 000 lines without saying so; neither view refreshes after a commit or checkout.
- A global `blame.ignoreRevsFile` pointing to a missing file makes every blame fail with git's message.
- Rendering 20 000 blame rows ("Show all") is slow; closing the view does not stop a long `log --follow` or blame.

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
