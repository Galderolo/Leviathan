# Development status

Snapshot of where Leviathan stands and what comes next, so a new working session can pick up without digging through history. Last updated: 2026-10-23, with 0.11.0 released (426 tests). Work goes on `feat/…` / `fix/…` branches pushed to GitHub and merged into `main` with a merge commit.

For long-term ideas see [ROADMAP.md](ROADMAP.md); for user-facing changes see [CHANGELOG.md](../CHANGELOG.md).

## Released

| Version | Date | Highlights |
|---|---|---|
| 0.1.0 | 2026-10-21 | Graph, staging (files, hunks, lines), commit, branches, merge/rebase, pull/push, stash, tags, clone/init |
| 0.2.0 | 2026-10-21 | Accounts (encrypted tokens, per-repo identity and HTTPS auth), fetch button, branch start point, branch dates |
| 0.3.0 | 2026-10-21 | Undo/redo, conflict editor, interactive rebase, pull requests, pull without checkout, unpushed-commit marks, new icon (no macOS installers) |
| 0.3.1 | 2026-10-22 | Same app as 0.3.0, with the macOS installers |
| 0.4.0 | 2026-10-22 | Sign in with GitHub, multi-file selection, close pull requests, file history and blame, word highlights and side-by-side diffs |
| 0.5.0 | 2026-10-22 | Automatic updates from the GitHub releases, graph focus (hide/solo branches, branch highlight, PR badges) |
| 0.6.0 | 2026-10-22 | Git LFS: tracked files, locks (mine / others, force unlock), patterns, warnings for big or non-LFS staged files, setup |
| 0.7.0 | 2026-10-22 | Big repositories (virtual file lists, ahead/behind cache, index stat refresh, ignored-folder churn), Ctrl+P / Ctrl+L, push after commit |
| 0.8.0 | 2026-10-22 | Submodules (state, update, open, commit lists in diffs, clone with them), side panel keeps folders collapsed |
| 0.8.1 | 2026-10-22 | Fixes: branch highlight follows the branch after a pull; submodule folders compared by real path |
| 0.9.0 | 2026-10-22 | What's new (release notes from GitHub or bundled), update checks every 30 min and on focus, no refresh while git holds the index |
| 0.9.1 | 2026-10-22 | Polish: clear buttons on search boxes, SSH keys folded, discard on submodules, LFS without git-lfs, lockable confirmation |
| 0.9.2 | 2026-10-22 | Graph column keeps room for six lanes; a release still being published is not an update error |
| 0.9.3 | 2026-10-22 | Resizable BRANCH / TAG and GRAPH columns (remembered), wide graphs scroll sideways |
| 0.9.4 | 2026-10-23 | Fixes: conflict stops are not errors, checkout shows what came along, Push counts unpushed commits, stashes list untracked files |
| 0.10.0 | 2026-10-23 | External editor, diff and merge tools, `leviathan .` from a terminal, one window per profile, discard asks with a count |
| 0.11.0 | 2026-10-23 | Sign in with GitLab, stash some files, Settings in sections saved at once |

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

## Git LFS (0.6.0)

Code: `src/shared/lfs.ts` (attributes and lock parsing), `src/main/git/lfs.ts` (git-lfs commands), `lfsFiles` / `largeFiles` in `getState`, `src/renderer/src/lfsView.ts`, the LFS section in `LeftPanel.tsx`, `LfsWarnings` in `RightPanel.tsx`. Tests run against a fake LFS lock server (`tests/lfsRepo.test.ts`, `lfs.url` pointing at 127.0.0.1) and skip when git-lfs is missing.

Things worth knowing about git-lfs (3.5):
- `git lfs locks --json` hides errors: an unreachable server, or one without `/locks/verify`, lists nothing with exit code 0. `getLfsLocks` asks again without `--json` when the list is empty, and falls back to unverified locks (owner shown, mine/theirs unknown).
- Unlocking a lockable file that does not exist locally fails after the server already released it (git-lfs cannot reset its permissions): `lfsUnlock` lists the locks again and treats a vanished lock as success.
- The user's own locks are released by path, so git-lfs refuses while the file has uncommitted changes; someone else's are released by id with `--force`.
- Patterns are read from the attributes files directly (works without git-lfs, never installs hooks as a side effect); `.git/info/attributes` is not read.
- Locks load without prompts when a repository opens and after a fetch; the reload button in the section may ask for credentials.
- Once a file goes through LFS, git compares its staged content with the cleaned (pointer) working copy and always reports a change. Before staging a file again through LFS, `changedSinceStaged` compares raw bytes (`hash-object --no-filters`) so a staged version is never replaced by a different working copy.
- Staged blob sizes are cached by hash in the main process (`src/main/git/staged.ts`), so a refresh with thousands of staged files does not ask git for every size again.
- Attribute macros (`[attr]lfs filter=lfs …`) are expanded when defined in the root `.gitattributes`, as git does.

## Big repositories (0.7.0)

Measured on real Unity projects (read-only, fingerprinted before and after) and on a synthetic repository (30 000 commits, 20 000 files, 1 500 branches with upstreams, 1 500 tags; generator kept outside the repo). What changed and why:
- **Virtual file lists** (`components/VirtualRows.tsx`, `virtualRows.ts`): only rows near the visible part of the scrolling container are rendered (rows are 25 px, `FILE_ROW_HEIGHT`). The side panel and the working-tree lists subscribe only to what they show (`useShallow`), so typing a commit message does not redraw them.
- **Ahead/behind cache** (`src/main/git/refs.ts`): `%(upstream:track)` is only asked for branches whose tip or upstream moved; `%(upstream:short)` is never asked (git checks every short name against all refs, 0.6 s with 4 500 refs), the short name is derived from `%(upstream)`.
- **Index stat refresh** (`shouldRefreshIndex` / `refreshIndexStat` in `repository.ts`): statuses never write the index (`GIT_OPTIONAL_LOCKS=0`), so stale stat info made every status re-read files (for LFS files, through `git-lfs filter-process`, about a second on Windows). After a status of 500 ms or more, at most every 5 minutes, `getState` runs `update-index -q --refresh`; the app's other commands in that repository wait for it (`holdingIndex` in `runner.ts`).
- **Index lock**: `add`, `commit`, `restore`, `reset`, `rm`, `mv`, `apply`, `update-index`, `checkout` and `switch` are retried for up to 2 s when another git holds `index.lock` (they fail before changing anything).
- **Watcher** (`watcher.ts`): working-tree changes are checked with `git check-ignore` before refreshing (all of them at once through stdin; folders not reported get a second try with a trailing slash so folder patterns match), and a refresh happens at least every 2 s while changes keep coming. When a burst overflows the OS change buffer, Windows reports changes without a path: those only refresh once things are quiet.
- **Refresh coalescing** (`coalesce.ts`, `refreshRepo`): a refresh asked for while one runs becomes a single extra refresh after it; everyone waiting gets that one.

Known minor issues left from the review (none loses work):
- An upstream outside `refs/remotes` / `refs/heads` (custom fetch refspec) is cached as gone: its ahead/behind is not recomputed when only the upstream moves.
- `VirtualRows` recomputes on scroll, resize and count changes only: if content above a commit's file list changes height by more than the overscan without any of those, part of the list stays blank until a scroll.
- Up to 200 branch names go on one command line when recomputing ahead/behind; refnames averaging over ~160 characters would exceed Windows' limit.
- The index-lock retry matches git's message in stderr, so a hook printing that same message would make a command run twice.
- The 500 ms "slow status" trigger also fires when status is slow for other reasons (many untracked files): the refresh then holds the index for nothing, once every 5 minutes.
- Caches per repository (ahead/behind, last index refresh) are not dropped when a tab closes.

Still slow-ish: with thousands of branches and tags expanded in the side panel (it is not virtualized), each state change costs around 50 ms per thousand rows; collapsing REMOTE / TAGS avoids it.

## Submodules (0.8.0)

Code: `src/shared/submodules.ts` (`.gitmodules` and gitlink parsing), `src/main/git/submodules.ts` (`getSubmodules`, `updateSubmodules`), `submoduleChange` in `getDiff`, the SUBMODULES section in `LeftPanel.tsx`, `SubmoduleSummary` in `DiffView.tsx`. Tests need `protocol.file.allow=always` for local submodule URLs (git refuses the file protocol for submodules by default); they set it in a scratch global config.
- Without `.gitmodules` nothing runs. The list loads on `git` refreshes, and on every refresh once a repository has submodules (edits inside them change their state).
- A submodule counts as initialized only when its folder has its own `.git` and `rev-parse --show-toplevel` is that folder; otherwise git would answer for the parent.
- Diffs always use `--submodule=short` (a user's `diff.submodule=log` would change the output); the commit list comes from `git log` inside the submodule, at most 100 each way.

- Updating refuses when a submodule that is on another commit has commits on no branch, tag or remote (`rev-list -1 HEAD --not --branches --tags --remotes`): `submodule update` would leave them behind silently.
- Cloning never uses `--recurse-submodules`: the clone is made, the account bound, then `initSubmodules` runs, so one submodule that cannot be fetched only produces a warning.
- Per-repository git arguments (accounts) pick the innermost repository, so a submodule open in its own tab uses its own account.

Known minor issues:
- The stale note counts submodules set to `update = none` and ones the user deinitialized on purpose; *Update all* re-initializes the latter.
- The submodule list loads twice after an update; commit lists capped at 100 give no "and more" sign.
- A renamed submodule's diff in a commit shows "No changes" (git prints no `index` line for a pure rename).
- `submodule update` paths are validated but not literal (`GIT_LITERAL_PATHSPECS`), and *Open in a new tab* on a submodule deinitialized outside the app focuses the parent instead.

## Bitbucket Cloud (unreleased)

Code: the `bitbucket` branches in `src/main/accounts/providers.ts`, `bitbucketIdentity` / `bitbucketRepos` there, the Bitbucket case of `checkoutPullRequest`. Researched in October 2026:
- App passwords stopped working in June 2026. Accounts use Atlassian API tokens with scopes (`read:user`, `read:workspace`, `read:repository`, `write:repository`, `read:pullrequest`, `write:pullrequest`, all `:bitbucket`), sent to the API as `Authorization: Bearer`; git takes them as the password of the Bitbucket username (case-sensitive, the one in remote URLs such as `https://user@bitbucket.org/…`), so that username is the account's and the form lets the user type it.
- Sign-in from the browser would need an OAuth consumer whose secret ships in the app: not done.
- `/user` gives the username, `/user/emails` the primary confirmed email (Bitbucket has no no-reply address; without that scope the form asks for the email). The account-wide repository list is gone: repositories come from `/user/workspaces`, then `/repositories/{workspace}?role=member` per workspace (at most 20 workspaces, 100 repositories).
- Pull requests: `/pullrequests?state=OPEN`, created with `source` / `destination` branches (and `draft`), closed with `/decline`; the main branch is `mainbranch.name`. Bitbucket keeps no pull request refs: a same-repository pull request is fetched from its branch (also as `pr/N` when a local branch of that name holds other work); one from a fork asks to add the fork as a remote.
- Bitbucket Data Center has another API: only `bitbucket.org`; a server goes as "Other".

## External tools (0.10.0)

Code: `src/shared/externalTools.ts` (editor presets, command templates, `git difftool` / `mergetool` arguments), `src/main/tools.ts` (launching), `src/main/cli.ts` (the command-line folder and the Windows PATH install), `components/ExternalToolsSettings.tsx`.
- The editor command is split like a shell would but run without one (cross-spawn, which also finds `.cmd` shims such as `code.cmd`). `{file}`, `{line}` and `{folder}` are filled in, in one pass; without a file, the file and line arguments (and the option right before them) are left out so the editor gets the folder. On Windows a program missing from the PATH still starts (cross-spawn falls back to cmd.exe) and only fails when cmd exits, so the launch waits up to a second for that before reporting success.
- Diff and merge tools go through `git difftool -y` / `git mergetool -y` (`--tool=` when one is picked in Settings; `mergetool.keepBackup=false`), so git's own tool settings and paths apply. With no tool in Settings nor in git's config (`diff.tool` or, as git difftool falls back to it, `merge.tool`), the app says so instead of letting git prompt. A commit's renamed file passes both paths; hashes are checked. Paths are literal (`GIT_LITERAL_PATHSPECS`), and `MSYS=noglob` stops Git for Windows' sh from expanding `[id].tsx` into another file's name when the tool starts. `git mergetool` itself loops over its files unquoted, so names with `[ ] * ?` are refused for the merge tool (the conflict editor handles them).
- One instance per profile (`requestSingleInstanceLock`): `leviathan <folder>` while the app runs hands the folder to the open window (`second-instance`). Folders wait in a queue until the window has restored its saved tabs and asks for them (`takeLaunchFolders`), and again after a reload; opened earlier, they raced with that restore and the saved tabs were overwritten. In development the first argument that is not a switch is electron's app folder and is skipped.
- Windows: *Add the leviathan command* writes `<userData>\bin\leviathan.cmd` (`start "" "<exe>" --cwd="%CD%\." %*`; the portable build's own `.exe`, not its temporary copy) and appends that folder to the user PATH in the registry, kept unexpanded (`REG_EXPAND_SZ`), then announces the change. `--cwd` is where the command was typed: the portable build runs from a temporary folder. cmd reads the file in the console code page, so the path names `%LOCALAPPDATA%`, `%APPDATA%` or `%USERPROFILE%` instead of folders that may have accents, and other non-ASCII paths are refused. The PATH is read back as base64 of UTF-16: PowerShell writes text to a pipe in the console code page, which garbled entries with accents. Only new terminals see it. `tests/cliInstall.test.ts` uses a scratch registry key, never the real PATH.

Known minor issues:
- Uninstalling the app leaves `leviathan.cmd` and its PATH entry behind.
- Tools that need a terminal (vimdiff…) cannot work: there is no terminal for them.
- On macOS and Linux the suggested symlink starts the binary itself, so the first instance stays attached to that terminal.
- A staged rename opens in the diff tool as a new file (only the new path is passed).
- The merge tool refuses files whose name has `[ ] * ?` (see above).

## Next steps

### 1. Keep an eye on 0.3.0

Pull requests were tested for real on a private GitHub repository (create as draft, list, check out by double-click). Still untested with a real server: GitLab merge requests and Gitea. Note that deleting a pull request's branch does not close it on GitHub; there is no "close pull request" action in the app yet.

### 2. Releasing the next version

1. Set the version in `package.json` (and `package-lock.json`).
2. Rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z] - <date>` and add an empty `[Unreleased]` above it.
3. Commit, then tag and push: `git tag vx.y.z && git push origin main vx.y.z`.
4. The Release workflow builds Windows, macOS and Linux and, when all three succeed, uploads the installers and publishes the release as a pre-release. There is nothing to click: publishing the draft by hand earlier is harmless, the upload still happens. If a build fails, the release stays an empty draft: fix, delete the draft and the tag, and tag again.

### 3. Sign in with the browser

Done for GitHub: Settings → Accounts → *Sign in with GitHub* runs the OAuth device flow with the project's OAuth App (client ID in `src/shared/providers.ts`, scopes `repo read:user`); the token goes straight into the encrypted account store. Code: `src/main/accounts/oauth.ts`, `startGitHubLogin` / `finishGitHubLogin` in `src/main/accounts/index.ts`.

GitLab.com (0.11.0; tried with a real account: sign-in, a forced renewal, and a clone of a private repository without prompts): gitlab.com answers the device flow with `access_denied` for this application, so *Sign in with GitLab* uses the authorization code flow with PKCE. The app listens on `127.0.0.1:47231` (the redirect URI registered with the application, ID `GITLAB_CLIENT_ID` in `src/shared/providers.ts`, scopes `api read_user write_repository`) before the browser is sent anywhere, so a busy port fails at once; only a callback with this sign-in's `state` is taken. GitLab's access tokens last two hours: the renewal token is stored encrypted next to it (`AccountStore.renewal`) and `TokenSource` renews five minutes before expiry, one renewal at a time per account (GitLab replaces the renewal token each time). Askpass asks for a token only once an account matches the prompt, so an unrelated expired account is never renewed. OAuth tokens work for git over HTTPS with the real username (GitLab only checks the password) and for the API as `Authorization: Bearer`, which also takes personal access tokens. Code: `src/main/accounts/gitlabOAuth.ts`, `src/main/accounts/tokens.ts`, `startGitLabLogin` / `finishGitLabLogin` in `src/main/accounts/index.ts`.

Still to do: GitHub Enterprise and self-managed GitLab (each server needs its own application).

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

**Git LFS**
- Pattern info has no sequence counter: two quick checkouts can leave the older patterns on screen until the next change.
- Locks are not loaded when git-lfs is installed while the app runs, until the next checkout or reopening the tab.
- Loading locks can take up to four git-lfs runs (verify, then without it); a host without the locks API shows a red error after every open or fetch, and an interactive reload without a credential helper may ask several times.
- An own lock on a file deleted locally (deletion not committed) is released by id, skipping git-lfs's uncommitted-changes check.
- Lock lookups per file row are linear in the number of locks (fine for hundreds).
- A pre-push hook from another tool (husky…) stops git-lfs from installing its own: the section says "not set up" and *Set up* fails with "Hook already exists" (`git lfs update --manual` is the way out).

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

**Stash**
- Stashing some files (`git stash push -- <paths>`) still keeps a picture of the whole index in the stash: files that were staged appear in it too, though they stay as they were in the working tree.

**File history and blame**
- File names with quotes, backslashes or tabs (Linux/macOS) come back quoted from `git log` (no `-z`), so their diff is empty.
- History of a staged rename starts from the new name, which HEAD does not have yet (empty list).
- A pure rename shows "No changes" with no "renamed from" note in the diff pane.
- History stops at 300 commits and blame at 20 000 lines without saying so; neither view refreshes after a commit or checkout.
- A global `blame.ignoreRevsFile` pointing to a missing file makes every blame fail with git's message.
- Rendering 20 000 blame rows ("Show all") is slow; closing the view does not stop a long `log --follow` or blame.

**Automatic updates**
- Nothing proves an installer is ours beyond HTTPS and the GitHub account: set `publisherName` once Windows builds are signed. Each check sends electron-updater's random staging id to github.com.
- AppImage updates replace `Leviathan-x.y.z.AppImage` with a file of the new name, which breaks launchers pointing at the old path.
- The Linux release builds AppImage and .deb from the same folder; a CI check that the AppImage has no `package-type` file would guard the updater choice.

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
