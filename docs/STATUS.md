# Development status

Snapshot of where Leviathan stands and what comes next, so a new working session can pick up without digging through history. Last updated: 2026-10-28, with 0.20.0 released (681 tests, 52 end-to-end). Work goes on `feat/…` / `fix/…` branches pushed to GitHub and merged into `main` with a merge commit.

For long-term ideas see [ROADMAP.md](ROADMAP.md); for user-facing changes see [CHANGELOG.md](../CHANGELOG.md).

**Name.** The app shows as *Git Leviathan* (after 0.19.0): Windows' Start search finds apps by the start of each word of their name, so both "git" and "lev" find it. Only what people see changed: the shortcuts (`nsis.shortcutName`, renamed in place on update), the uninstall entry, the installers' file names, the macOS display name (`CFBundleDisplayName`), the Linux menu entry, the window title and the app's texts. `productName`, `appId`, the executable, the install and user data folders (`%APPDATA%\Leviathan`), the `leviathan` command, the GitHub repository and the OAuth apps' names stay Leviathan, so updates land on the same install and keep settings and accounts (on macOS the token key lives in the keychain under the app's name).

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
| 0.12.0 | 2026-10-23 | Bitbucket Cloud accounts and pull requests, stash mine and apply, VS Code as diff/merge tool fixed |
| 0.13.0 | 2026-10-23 | Pull request review in the app, rebase drag and drop and edit, syntax highlighting, pull and push when a push is refused, editors found off the PATH, LFS servers without locks |
| 0.14.0 | 2026-10-23 | Security: no program is started from a repository folder on Windows; choose the terminal, folder history, merge methods the project allows |
| 0.15.0 | 2026-10-26 | Reorder tabs by dragging, commits to pull and push on each tab, whole file in diffs |
| 0.15.1 | 2026-10-26 | Security: SSH key passphrase off ssh-keygen's command line; background fetch no longer clashes with pull/push; asks before whole-file conflict takes and drop checkout-merge; rebase stop reasons; history/blame say when cut short; dialogs keep fast typing |
| 0.16.0 | 2026-10-26 | Edit conflicts by hand, pick the commit identity (the owning account's by default), blame before a change, optional avatars from every provider and Gravatar, SSH aliases recognised, async safeStorage |
| 0.17.0 | 2026-10-27 | Keyboard shortcuts (Space stages, arrows go through files), install git-lfs from the app, graph columns hidden, moved and resized, commit message template, narrow windows keep the graph; two polish batches of fixes |
| 0.18.0 | 2026-10-28 | Settings per repository: auto-fetch, pull mode, push after commit, commits loaded, avatars, editor, terminal and diff tool |
| 0.18.1 | 2026-10-28 | Settings per repository keep only what depends on the project (terminal and avatars general again), apart at the bottom of Settings |
| 0.19.0 | 2026-10-28 | A terminal inside the app (one per repository), change marks beside the diff's scrollbar, polish batch 4 (LFS beside other tools' hooks, installer messages, stopping file history and blame, settings saved while Windows holds the file), resolving a conflict no longer closes the next file |
| 0.20.0 | 2026-10-28 | The app shows as Git Leviathan (shortcuts renamed on update; folders, settings and accounts unchanged) |

All are published as pre-releases on GitHub. The 0.2.0 release has no Linux installers: the three build jobs ran in parallel and the Linux one most likely uploaded to a second draft release. The 0.3.0 release has no macOS installers: it was published while the macOS build was still waiting for a runner, and that build only uploaded into drafts. Since 0.3.1 the builds keep their installers as artifacts and a last job uploads them all and publishes, whatever the state of the release.

## Done in 0.3.0

All of these went through a final whole-branch review; Critical and Important findings were fixed with a failing test first.

- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z): commits, amends, checkouts, branch and tag changes, merges, rebases, cherry-picks, reverts, resets, pulls, and discards (files, hunks, all changes) and stashes (save, apply, pop, delete). Discards and stashes are recorded with a copy of the files they touch (`getSnapshot(repo, paths)`: their bytes as blobs, `hash-object -w --no-filters`, and their index entries) and the stash list; applying writes them back (`unpack-file`, `update-index --index-info`) and drops or stores stashes again (`stash store`). Files over 50 MB (`UNDO_FILE_MAX`) and symlinks get no copy: then nothing is recorded and the app says so. It refuses to undo while an operation is in progress, keeps branch settings (upstream) when branches are deleted, created or renamed, and undoing a merge commit brings the merge back. Code: `src/shared/undo.ts`, `applyChange` / `getSnapshot` in `src/main/git/repository.ts`, `src/renderer/src/undoStack.ts`.
- **Conflict editor**: current and incoming versions side by side, choices per block or the whole file (including deletions and submodules). Files over 2 MB or not in UTF-8 can only take a side, and a save is refused if the file changed since it was opened. Code: `src/shared/conflicts.ts`, `components/ConflictView.tsx`.
- **Interactive rebase**: right-click a commit → reorder (arrows, Alt+↑/↓ or drag by the grip), reword, edit, squash, fixup, drop. `edit` makes git stop without an error after applying the commit: git leaves `rebase-merge/amend`, which `getState` reports as `editing`; the app then shows the banner (the WIP row stays while any operation is in progress, `wipShown`) and the user amends and continues (0.13.0). No editor is ever opened; the todo list and messages are prepared in `<gitdir>/leviathan-rebase/` and applied with `GIT_SEQUENCE_EDITOR=cp`. With merges in the range, git's own `--rebase-merges` list is the plan: `rebaseScript` lets git make it with an editor that copies it and fails (so nothing starts; hooks are off for it), `parseRebaseScript` reads it, and `planRebaseWithMerges` keeps its `label` / `reset` / `merge -C` lines and plans each run of a branch's commits as `planRebase` plans a whole rebase. The dialog then shows the merges as fixed rows and a dashed line where a merged branch starts; commits are not moved (a squash or fixup melds only into a commit of its own branch, `rebaseProblemWithMerges`). Code: `src/shared/rebase.ts`, `interactiveRebase` in `repository.ts`, `components/RebaseDialog.tsx`.
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

Installing git-lfs from the app (code: `src/main/lfsInstall.ts`, pure helpers in `src/shared/lfsInstall.ts`; the question and the actions in `askToInstallGitLfs` / `installGitLfs` in `actions.ts`):
- The active tab's repository asks once per session when it uses LFS and git-lfs is missing (`lfsAsked`); the LFS section and `LfsWarnings` offer the same install. What the app can do is asked once at start (`getLfsInstallOffer`): Windows the official zip; macOS Homebrew (else the download page); Linux `pkexec` with apt-get, dnf, zypper or pacman (without pkexec, the command to type; pkexec exiting 126/127 turns into that command too).
- Windows: `git-lfs-windows-<arch>-v<version>.zip` from the latest release on GitHub, checked against the release's `sha256sums.asc` (trust is HTTPS to GitHub: the file's PGP signature is not verified), extracted with Windows' own `tar.exe` into `%LOCALAPPDATA%\Programs\Git LFS` and added to the user's PATH (`addToUserPath` in `cli.ts`). It is not in Windows' installed apps; removing it is deleting that folder. The official `.exe` installer is not used: run without questions it refuses a git outside Program Files (a per-user Git for Windows, Scoop).
- After installing: `git lfs install` for the user, then the repository is set up (`setupLfs`: hooks, real files instead of pointers) and every open repository reads its LFS info again; nothing needs a restart, since git is spawned with the main process's PATH, which gains the new folder.
- git-lfs installed where the app's PATH does not look (Homebrew's folders for an app opened from the Finder, the per-user folder before the PATH change reaches this process) is found by `lfsVersion` through `locateProgram('git-lfs')`. Coming back to the window re-reads the LFS info of repositories that miss git-lfs (`recheckGitLfs`, every 10 s at most), so one installed by hand is noticed and its locks load.
- `LEVIATHAN_E2E_NO_GIT_LFS` makes the main process act as if git-lfs were missing, for the end-to-end test only (git for Windows ships git-lfs next to git).

## Big repositories (0.7.0)

Measured on real Unity projects (read-only, fingerprinted before and after) and on a synthetic repository (30 000 commits, 20 000 files, 1 500 branches with upstreams, 1 500 tags; generator kept outside the repo). What changed and why:
- **Virtual file lists** (`components/VirtualRows.tsx`, `virtualRows.ts`): only rows near the visible part of the scrolling container are rendered (rows are 25 px, `FILE_ROW_HEIGHT`). The side panel and the working-tree lists subscribe only to what they show (`useShallow`), so typing a commit message does not redraw them.
- **Virtual side panel** (`TreeView` in `LeftPanel.tsx`, `visibleTreeRows` in `utils.ts`): the branch, remote and tag trees are flattened into the rows that show (folded folders hide theirs) and drawn with `VirtualRows` at 24 px (`.side-row`). With 4 500 refs: 34 580 DOM nodes down to 375, folding a section from 0.7–0.9 s to about 20 ms, typing four letters in the filter from 1.4 s to 65 ms (0.13.0).
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

## Pull request review (0.13.0)

Code: `fetchPullRequestRange` / `getRangeFiles` in `repository.ts`, the review functions at the end of `src/main/accounts/providers.ts` and `accounts/index.ts`, `components/PullRequestView.tsx`.
- Files and diff come from git, not from provider diff APIs: the pull request (the same source as checkout: `refs/pull/N/head`, GitLab's merge request ref, Bitbucket's branch) is fetched into `refs/leviathan/review/N` — not checkout's `refs/leviathan/pulls/N`, which tells whether `pr/N` has commits of its own — with its target branch; the range is merge-base..head, shown with the usual viewer. Nothing is checked out. The ref is deleted when the review ends however it ends (the review's component unmounting), and a new review drops any left from one that did not end (the app closed).
- The merge dialog offers what the project allows, its default first (`allowedMergeMethods`): GitHub's `allow_merge_commit` / `allow_squash_merge` / `allow_rebase_merge`, GitLab's `squash_option`, the target branch's `merge_strategies` / `default_merge_strategy` on Bitbucket, Gitea's `allow_*` and `default_merge_style`. Settings the token cannot read offer every method.
- The conversation comes from the provider: general comments and comments on lines (shown read-only with a link to their file), GitLab's system notes and Bitbucket's deleted and pending comments left out. Comment, approve, merge: GitHub `issues/N/comments`, `pulls/N/reviews` (APPROVE), `pulls/N/merge`; GitLab notes, `approve`, `merge` (`squash`; no rebase there); Bitbucket `comments`, `approve`, `merge` (`merge_commit` / `squash` / `rebase_fast_forward`); Gitea `issues/N/comments`, `pulls/N/reviews` (APPROVED), `pulls/N/merge` (`Do`). Merging checks the pull request is still the one the review showed, like closing one.
- The E2E test is skipped on Linux CI: the runner has no keyring, and the app does not keep tokens only obfuscated. It fakes GitHub without network: `GIT_SSH_COMMAND` runs `git upload-pack` on a local bare repository behind `git@github.com:org/app.git`, and `fetch` is replaced in the main process.

Known minor issues:
- Comments cannot be written on a line yet, and Markdown in comments shows as plain text.
- At most one page of comments is read (100; Gitea 50); GitLab keeps the newest.
- Approving and merging name the reviewed commit (GitHub `commit_id` / `sha`, GitLab `sha`, Gitea `commit_id` / `head_commit_id`; Bitbucket is checked first), so a pull request that moved on is refused.
- A project that only allows a method the app does not offer (Bitbucket's fast-forward, GitLab's fast-forward merge) still gets the usual choices, and the server's refusal.

## Syntax highlighting (0.13.0)

Code: `src/shared/syntax.ts` (language by file name, highlight.js output to classed text per line, merged with the changed-words marking), `src/renderer/src/syntax.ts` (highlight.js core with the registered languages, per hunk), `LineText` in `components/DiffLines.tsx`, the `--syn-*` colours in `app.css`.
- Each side of a hunk (context and removed lines; context and added lines) is highlighted as one piece of code, so comments and strings spanning lines stay right inside a hunk; one that starts before the hunk is not known.
- Text is never injected as HTML: highlight.js's output is turned into text pieces with a class, and pieces that do not add up to the line fall back to the plain text.
- Plain beyond 2 000 characters per line, 100 000 per hunk or 300 000 per diff. Unknown extensions are not guessed (no auto-detection). Shaders use GLSL's grammar, the closest highlight.js has to HLSL.

## Bitbucket Cloud (0.12.0; tried with a real account: identity, repository list, git authentication)

Code: the `bitbucket` branches in `src/main/accounts/providers.ts`, `bitbucketIdentity` / `bitbucketRepos` there, the Bitbucket case of `checkoutPullRequest`. Researched in October 2026:
- App passwords stopped working in June 2026. Accounts use Atlassian API tokens with scopes (`read:user`, `read:workspace`, `read:repository`, `write:repository`, `read:pullrequest`, `write:pullrequest`, all `:bitbucket`), sent to the API as `Authorization: Bearer`; git takes them as the password of the Bitbucket username (case-sensitive, the one in remote URLs such as `https://user@bitbucket.org/…`), so that username is the account's and the form lets the user type it.
- Sign-in from the browser would need an OAuth consumer whose secret ships in the app: not done.
- `/user` gives the username, `/user/emails` the primary confirmed email (Bitbucket has no no-reply address; without that scope the form asks for the email). The account-wide repository list is gone: repositories come from `/user/workspaces`, then `/repositories/{workspace}` per workspace, most recently updated first (at most 50 workspaces, 100 repositories; no `role=member`, which left out repositories the user owns). Clone URLs are built without the username Bitbucket puts in its clone links: git would use it over the account bound to the repository.
- Pull requests: `/pullrequests?state=OPEN`, created with `source` / `destination` branches (and `draft`), closed with `/decline`; the main branch is `mainbranch.name`. Bitbucket keeps no pull request refs: a same-repository pull request is fetched from its branch (also as `pr/N` when a local branch of that name holds other work); one from a fork asks to add the fork as a remote.
- `state=OPEN` includes draft pull requests (checked on a public repository in October 2026; an Atlassian ticket said it did not). A token missing scopes gets a 403 naming them (`error.detail.required`). A nickname is not a username: without `username` from the API, the form asks for it.
- Bitbucket Data Center has another API: only `bitbucket.org`; a server goes as "Other".

## External tools (0.10.0)

Code: `src/shared/externalTools.ts` (editor presets, command templates, `git difftool` / `mergetool` arguments), `src/main/tools.ts` (launching), `src/main/cli.ts` (the command-line folder and the Windows PATH install), `components/ExternalToolsSettings.tsx`.
- The editor command is split like a shell would but run without one (cross-spawn, which also finds `.cmd` shims such as `code.cmd`). `{file}`, `{line}` and `{folder}` are filled in, in one pass; without a file, the file and line arguments (and the option right before them) are left out so the editor gets the folder. On Windows a program missing from the PATH still starts (cross-spawn falls back to cmd.exe) and only fails when cmd exits, so the launch waits up to a second for that before reporting success. A program the PATH does not find is looked for where its installer puts it (`findProgram` in `src/main/programs.ts`: Rider from JetBrains' installer or Toolbox, Visual Studio, Sublime Text, Notepad++, VS Code, Cursor; the newest version folder first) (0.13.0).
- Program search (`src/main/programSearch.ts`, imported first by `index.ts`): Windows looks for a program named without a path in the working folder before the PATH, and every git command runs with a repository as working folder, so a committed `git.exe` would run on opening it (it did up to 0.13.0). The main process sets `NoDefaultCurrentDirectoryInExePath=1` before anything starts; libuv, cmd and the programs they start honour it (`tests/programSearch.test.ts` and an end-to-end test plant `whoami.exe` as `git.exe`). On top of that, `locateProgram` returns full paths and cmd is started as `ComSpec`.
- Terminals (`openTerminal` in `tools.ts`, presets per platform in `terminalPresets`): with none chosen, the system's (`openSystemTerminal` in `shell.ts`: cmd, Terminal, the first Linux terminal found). A chosen one is found with `locateProgram` first (Git Bash lives outside the PATH, `wt` is an app execution alias in `WindowsApps`), so a missing one is reported instead of Windows' own error box, and starts in the repository's folder (`{folder}` also gives its path). On Windows it goes through `cmd /d /s /c "start "" …"` run verbatim (`windowsStartLine`): a console program started straight from the app gets no window. Arguments are quoted for cmd and quotes are refused; cmd still expands `%…%`, so the Windows presets never put the folder on the command line (`wt -d .`, `git-bash --cd=.`).
- Diff and merge tools go through `git difftool -y` / `git mergetool -y` (`--tool=` when one is picked in Settings; `mergetool.keepBackup=false`), so git's own tool settings and paths apply. With no tool in Settings nor in git's config (`diff.tool` or, as git difftool falls back to it, `merge.tool`), the app says so instead of letting git prompt. A commit's renamed file passes both paths; hashes are checked. Paths are literal (`GIT_LITERAL_PATHSPECS`), and `MSYS=noglob` stops Git for Windows' sh from expanding `[id].tsx` into another file's name when the tool starts. `git mergetool` itself loops over its files unquoted, so names with `[ ] * ?` are refused for the merge tool (the conflict editor handles them).
- One instance per profile (`requestSingleInstanceLock`): `leviathan <folder>` while the app runs hands the folder to the open window (`second-instance`). Folders wait in a queue until the window has restored its saved tabs and asks for them (`takeLaunchFolders`), and again after a reload; opened earlier, they raced with that restore and the saved tabs were overwritten. In development the first argument that is not a switch is electron's app folder and is skipped.
- Windows: *Add the leviathan command* writes `<userData>\bin\leviathan.cmd` (`start "" "<exe>" --cwd="%CD%\." %*`; the portable build's own `.exe`, not its temporary copy) and appends that folder to the user PATH in the registry, kept unexpanded (`REG_EXPAND_SZ`), then announces the change. `--cwd` is where the command was typed: the portable build runs from a temporary folder. cmd reads the file in the console code page, so the path names `%LOCALAPPDATA%`, `%APPDATA%` or `%USERPROFILE%` instead of folders that may have accents, and other non-ASCII paths are refused. The PATH is read back as base64 of UTF-16: PowerShell writes text to a pipe in the console code page, which garbled entries with accents. Only new terminals see it. `tests/cliInstall.test.ts` uses a scratch registry key, never the real PATH.

Known minor issues:
- Uninstalling the app leaves `leviathan.cmd` and its PATH entry behind.
- Tools that need a terminal (vimdiff…) cannot work: there is no terminal for them.
- On macOS and Linux the suggested symlink starts the binary itself, so the first instance stays attached to that terminal.
- A staged rename opens in the diff tool as a new file (only the new path is passed).
- The merge tool refuses files whose name has `[ ] * ?` (see above).
- A repository on a network or WSL path (`\\server\…`, `\\wsl.localhost\…`) opens the terminal in `C:\Windows`: cmd, which starts it, cannot work in such a folder.

## Keyboard shortcuts

`src/renderer/src/shortcuts.ts` holds them: `globalShortcut` reads the app-wide ones (Ctrl or ⌘ alike), handled in `App.tsx` unless a modal is open; `fileKey` the ones of a changed-files list, handled by `listKeys` in `RightPanel.tsx` once the list has the focus (a click on it gives it); `SHORTCUT_GROUPS` is the list Settings shows (F1, or Ctrl+/, which Spanish keyboards type with Shift). After Space or Delete the next file of the list opens (`nextAfter`), so a run of files goes by with the keys alone. Undo and redo in a text box stay the box's own.

## Terminal

A console below the graph (`components/TerminalPanel.tsx`), one per repository, toggled by the toolbar button or Ctrl + the key left of 1 (`code === 'Backquote'`, whatever it types). The main process runs it with node-pty (`src/main/terminal.ts`: `Terminals`, `shellFor`, `integratedShell`, `terminalEnv`; loaded on first use, so the app still works if the native module cannot load); the window draws it with xterm.js (`src/renderer/src/terminals.ts`, loaded on first use too). Sessions live outside React: a tab switch or hiding the panel only moves the terminal's element, and the console goes on; closing the tab ends it. Output reaches the window as `terminal-data` events; keys typed go back with `terminalWrite`. While the focus is in the terminal, the app's shortcuts are the shell's except the one that hides it; `terminalKey` keeps copy (with a selection) and paste.

- Shell: on Windows the terminal chosen in Settings when it is cmd, PowerShell 7 or Git Bash (next to the git on the PATH) and installed, Windows PowerShell otherwise; `$SHELL` elsewhere, as a login shell on macOS. `ELECTRON_*` variables are left out of its environment.
- On Windows, node-pty keeps a thread alive until a console is killed, also one that ended on its own: `Terminals` kills those too, and every console is stopped on `window-all-closed` and on `will-quit` (`app.quit()` skips the former), or the app would not exit. Its console drops what is typed before the program in it starts.
- Packaging: node-pty is unpacked from the asar (its helpers run from disk) without its sources and debug symbols (about 6.5 MB), and `npmRebuild: false`: it is a Node-API module, prebuilt for Windows and macOS and compiled by `npm ci` on Linux (so Linux contributors need a C++ toolchain). Its macOS `spawn-helper` is published without the execute bit ("posix_spawnp failed"): `scripts/fix-node-pty.cjs`, run as `postinstall`, sets it, and packaging keeps it.
- Several consoles per repository, in tabs (`RepoView.consoles`, `activeConsole`; sessions keyed by the tab's `key`, not the main process's id, so a restarted console keeps its tab); closing the last one hides the panel. URLs in the output are links (`@xterm/addon-web-links`), opened with Ctrl+click (⌘ on macOS, `opensLink`) through `openExternal`. Font size: `settings.terminalFontSize` (9–24, `terminalFontSize`), in Settings → External tools.
- Not done: splitting the panel, restoring consoles after a restart.
- Each console killed on Windows prints "AttachConsole failed" from node-pty's `conpty_console_list_agent` (it then falls back to the shell's own process). A test build used for a while exited with code 127 when its window was closed (twice); closing it in tests, with or without consoles, exits with 0. Not reproduced.

## Settings per repository

A repository can have its own auto-fetch interval, pull mode, push after commit, commits loaded at a time, editor and diff tool (Settings → This repository, apart at the bottom of the list, or the toolbar's repository menu). Only what depends on the project: the terminal, avatars (0.18.0 had them per repository too; values saved then are ignored), accounts, SSH keys, shortcuts and the rest stay general. They are kept in `settings.repoSettings` by repository path, only the values that differ: "Same as general" removes the value, so the repository follows the general setting again even when it changes later. `src/shared/repoSettings.ts` has `settingsFor` (the settings as a repository sees them, used by the renderer and by `src/main/tools.ts`), `ownSettings` (values of the wrong kind in a hand-edited file are ignored) and `withRepoSetting`. A mode picked in the Pull menu, or the commit box's push checkbox, changes the repository's own value when it has one and the general one otherwise (`saveSettingFor` in `actions.ts`). A repository's values stay when its tab closes, as its account does. The section is `components/RepoSettingsSection.tsx`.

## Next steps

### 1. Pull requests on real servers

Pull requests were tested for real on a private GitHub repository (create as draft, list, check out by double-click, close). Still untested with a real server: GitLab merge requests and Gitea. Deleting a pull request's branch does not close it on GitHub: *Close pull request…* in its menu does.

### 2. Releasing the next version

1. On a `release/x.y.z` branch: set the version in `package.json` and `package-lock.json` (`npm version x.y.z --no-git-tag-version`), rename `## [Unreleased]` in `CHANGELOG.md` to `## [x.y.z] - <date>` with an empty `[Unreleased]` above it, and add the version to the table above and to the line at the top. Commit as `release: x.y.z`.
2. Push the branch, merge it into `main` with `--no-ff` once CI on `main` is green, and tag the merge: `git tag vx.y.z && git push origin main vx.y.z`.
3. The Release workflow builds Windows, macOS and Linux and, when all three succeed, uploads the installers and publishes the release as a pre-release. There is nothing to click: publishing the draft by hand earlier is harmless, the upload still happens. If a build fails, the release stays an empty draft: fix, delete the draft and the tag, and tag again.

### 3. Sign in with the browser

Done for GitHub: Settings → Accounts → *Sign in with GitHub* runs the OAuth device flow with the project's OAuth App (client ID in `src/shared/providers.ts`, scopes `repo read:user`); the token goes straight into the encrypted account store. Code: `src/main/accounts/oauth.ts`, `startGitHubLogin` / `finishGitHubLogin` in `src/main/accounts/index.ts`.

GitLab.com (0.11.0; tried with a real account: sign-in, a forced renewal, and a clone of a private repository without prompts): gitlab.com answers the device flow with `access_denied` for this application, so *Sign in with GitLab* uses the authorization code flow with PKCE. The app listens on `127.0.0.1:47231` (the redirect URI registered with the application, ID `GITLAB_CLIENT_ID` in `src/shared/providers.ts`, scopes `api read_user write_repository`) before the browser is sent anywhere, so a busy port fails at once; only a callback with this sign-in's `state` is taken. GitLab's access tokens last two hours: the renewal token is stored encrypted next to it (`AccountStore.renewal`) and `TokenSource` renews five minutes before expiry, one renewal at a time per account (GitLab replaces the renewal token each time). Askpass asks for a token only once an account matches the prompt, so an unrelated expired account is never renewed. OAuth tokens work for git over HTTPS with the real username (GitLab only checks the password) and for the API as `Authorization: Bearer`, which also takes personal access tokens. Code: `src/main/accounts/gitlabOAuth.ts`, `src/main/accounts/tokens.ts`, `startGitLabLogin` / `finishGitLabLogin` in `src/main/accounts/index.ts`.

Still to do: GitHub Enterprise and self-managed GitLab (each server needs its own application).

### 4. Small decisions pending

- Optionally bring the UI accent colour (teal) closer to the blue of the new icon.

Set aside on 2026-10-26, not to be brought up again unless asked: a Windows `.zip` target; commit messages written by AI; author profiles per group of repositories (the commit identity picker and the owning account's identity by default cover it); translations by the maintainer (more languages come from native speakers).

## Known minor issues

Found by reviews and left for later; none loses work. Good first contributions.

**Undo / redo**
- Applying a change is not atomic (could use `update-ref --stdin`). One undo or redo runs at a time per repository (`historyRuns` in `actions.ts`): a press while one is applied is ignored.
- An action recorded for undo waits for a background fetch under way, and none starts until it is recorded (`recording` in `actions.ts`): otherwise the tags it brought were part of the change.
- The first commit of an empty repository cannot be undone.
- Undoing a hard reset brings back the uncommitted changes of tracked files it dropped; redoing it sets those files to HEAD first (`filesToHead`), as `reset --keep` refuses local changes. Discarding everything during a merge or rebase is not recorded (it ends the operation).
- Undoing a branch rename restarts its reflog; undoing a merge commit does not restore `MERGE_MODE` (`--no-ff`).

**Conflict editor**
- `=======` inside the current side is read as the separator (git and other editors share this ambiguity).
- Whole-file buttons ask first when the file is not what git left (`conflictFileEdited`: git's result made again with `git merge-file --object-id` from the index stages, compared without marker labels or CRs). Before git 2.43 (no `--object-id`), a merge driver, `-X` options or LFS files it cannot be made again, so they always ask.
- No line limit: up to 2 MB is rendered as one element per line.
- *Edit by hand* is a plain text box (no highlighting) over the whole file, starting from `draftConflicts` (chosen blocks resolved, the others with their markers as they were). A text box keeps LF only: the save puts back the line ending most of the file had (`lineEnding`, `withLineEnding`), so a file mixing CRLF and LF comes out with one of them. A save refused because the file changed keeps the typed text on screen; *Back to blocks* reads the file again.

**Interactive rebase**
- A merge, cherry-pick, revert or rebase that stops for something other than conflicts shows only git's reason (`stopReason`: its errors, without progress, hints, or lines naming commands); a line git words differently in another version may still slip through.
- A rebase that stopped for a conflict and was continued is not undoable.
- If the commit a squash group melds into ends up empty, the squashed messages are not merged into the previous commit.
- With merges in the range, commits keep their places (no reordering) and a merge keeps its message; a squash or fixup cannot cross a merge or a branch start.

**Git LFS**
- Loading locks can take up to four git-lfs runs (verify, then without it), and an interactive reload without a credential helper may ask several times. A host without the locks API (Bitbucket Cloud) is told apart by git-lfs's message (`NO_LOCKING_API` in `src/main/git/lfs.ts`: "not found", "not supported", 404), so a different wording from a server would show as an error again (0.13.0).
- An own lock on a file deleted locally (deletion not committed) is released by id, skipping git-lfs's uncommitted-changes check.
- Lock lookups per file row are linear in the number of locks (fine for hundreds).
- A hook of another tool (husky…) stops `git lfs install` at the first one, setting none up. *Set up* then writes the missing hooks as git-lfs would, downloads the files and offers git-lfs's instructions (`git lfs update --manual`) for the other tool's hooks, which stay as they were: the section says "not set up" until those lines are added by hand. A hook that is husky's wrapper is read as it is (the lines may live in `.husky/pre-push`).

**Pull requests**
- 403 messages are generic (no Gitea scope). A 401 in the side panel says the token stopped working and links to Settings → Accounts (0.13.0), matched on the "rejected the token" text.
- Up to 500 open PRs are listed (`PULL_REQUESTS_MAX`), asked 100 at a time (50 on Bitbucket and Gitea) until a page is not full: a Gitea server whose page limit is below 50 lists only its first page. Fork workflows (origin = personal fork) list the fork's PRs, not the parent's.

**SSH aliases**
- `SshHosts` (`src/main/git/sshHosts.ts`) rewrites SSH remote URLs with the host `ssh -G <alias>` reports (once per name per session; names that could read as an option are never passed) before the accounts module looks for the account of a repository (pull requests, default identity, avatars, and `repoUsesHost` for the "this account's host is not among the remotes" hint after binding an account).

**Avatars**
- Off by default (`settings.avatars`): `getAvatars` in the main process asks nothing until then. Sources per email (`avatarSources`, `src/main/avatars.ts`): GitHub no-reply address -> `avatars.githubusercontent.com/u/<id>`, an own GitHub account's email -> `github.com/<user>.png`, then the repository's server through its account (`authorAvatar`: GitHub and Gitea by the author of one of their commits, Bitbucket by the user of that commit's author, GitLab by email with `/avatar`), then Gravatar (SHA-256, `d=404`). Pictures come to the window as data: URLs (its CSP allows no remote images), cached in `avatars.json` in the profile: found for 7 days, none for 1 day, an unreachable server not at all. Asked once per email per session.

**Accounts**
- Tokens go through Electron's asynchronous safeStorage (`encryptStringAsync`, `decryptStringAsync`, `isAsyncEncryptionAvailable`); `AccountStore` encrypts a secret again when `shouldReEncrypt` says its key rotated. On Windows both calls write the same `v10` format, checked both ways, so an older version still reads tokens saved by this one.
- Commit identity (`getCommitIdentity`, `setCommitIdentity`, `ensureDefaultIdentity` in `src/main/accounts/index.ts`, `src/main/git/identity.ts`, `src/shared/identity.ts`): a repository without a local `user.name`/`user.email` and not bound to an account is bound, when opened, to the account that owns its project (first path part = username, no request) or else the first on that host whose token may push (`canPush`: GitHub/Gitea `permissions.push`, GitLab Developer or above, Bitbucket write/admin). Nothing found is remembered for the session only. A local identity is never replaced; renaming an account only updates the repositories that still have its old identity. Picking an identity typed or the global one keeps the binding (its token still serves push and pull).
- Usernames with `%` or `@` in the askpass prompt; `*.ghe.com` API base and no-reply emails for hosts with a port.
- Nested repositories match the first registered repository, not the deepest; Windows path casing in the repository → account map.
- `other` accounts get an invented default email.
- GitHub sign-in: network and server errors while waiting are asked again, three in a row end it; no local deadline besides GitHub's `expired_token`; secure storage is only checked after the browser step; a cancel pressed after GitHub issued the token still adds the account.

**Multi-file selection**
- The divider: every move re-renders the panel (may stutter with huge lists); focused, the arrow keys move it.
- Checkboxes in the staged list do not exclude files from the commit (unlike GitHub Desktop).

**Diffs**
- *Whole file* asks git for the same diff twice: as usual (the hunks that stage, unstage and discard) and with `-U100000000` (`WHOLE_FILE`), whose context lines fill the gaps (`unchangedGaps`, by old line number). Near INT_MAX git splits the file into overlapping hunks (it doubles the context when joining them). Each gap is highlighted on its own, so a comment opened in a gap is not known in the next hunk.
- An open diff keeps an outdated untracked flag when the file stays in the same list (`git rm --cached`).

**Stash**
- Stashing some files (`git stash push -- <paths>`) still keeps a picture of the whole index in the stash: files that were staged appear in it too, though they stay as they were in the working tree.

**File history and blame**
- *Blame before this change* uses the `previous <commit> <path>` that `git blame --porcelain` gives each commit (its parent, and the file's name there): the earlier blame opens at the line number the line had in the commit that changed it (`origLine`), only a guess of where it was in the parent. *Back* is a stack in `fileView.back`.
- File and folder history list 300 commits at a time (*Show more*, up to 5 000: `HISTORY_PAGE`, `HISTORY_MAX`), and blame stops at 20 000 lines (`BLAME_MAX_LINES`); both say so. Views of HEAD or the working tree are read again when HEAD moves (`useHeadKey`), not when the working file alone changes.
- Rendering 20 000 blame rows ("Show all") is slow. Closing the view, or asking again, stops git's work for it (`stopFileView`, one `LatestRun` per repository in `ipc.ts`; git commands take a `signal`).
- Folder history (`getFolderHistory`: `git log -- <folder>`, literal pathspec, 300 commits) loads the picked commit's whole file list (`getCommitDetails`) and keeps the folder's part (`filesInFolder`, moves in and out included), so a commit of 20 000 files costs the same as in the graph. Files compare with the first parent: a merge that brought the folder's changes may list nothing.

**Automatic updates**
- Nothing proves an installer is ours beyond HTTPS and the GitHub account: set `publisherName` once Windows builds are signed. Each check sends electron-updater's random staging id to github.com.
- AppImage updates replace `Leviathan-x.y.z.AppImage` with a file of the new name, which breaks launchers pointing at the old path.
- The Linux release builds AppImage and .deb from the same folder; a CI check that the AppImage has no `package-type` file would guard the updater choice.

**Older items**
- A new SSH key's passphrase reaches ssh-keygen through a one-off askpass bridge (`keygenWithPassphrase` in `src/main/ssh.ts`; `askpass.cmd` for Windows' own OpenSSH, which cannot run `askpass.sh`), then the key is checked to refuse an empty passphrase. Tried with OpenSSH for Windows 9.5; Git for Windows' own ssh-keygen (when it comes first in the PATH) running the `.cmd` is untested — if it cannot, the key is refused, not left unprotected.
- A push sets the upstream only on a branch's first publish to a remote (or when its upstream is gone): an upstream with another name set after that is kept (`push` in `src/main/git/repository.ts`). One set on purpose before the first publish is replaced, as `git push -u` would; a branch that follows another one counts its pushes and pulls against it, as `git status` does.
- The locale test does nothing without a translated git.

## Working on it

```bash
npm ci
npm run dev          # app with hot reload
npm test             # vitest, real git repositories in temp folders
npm run e2e          # Playwright drives the built app (after npm run build)
npm run typecheck
npm run format:check
npm run dist:win     # installers in dist/ (also dist:mac, dist:linux)
```

- From a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` before launching Electron (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
- A test build that can't be mistaken for a release: `npx electron-builder --win -c.extraMetadata.version=0.3.0-dev --publish never` (after `npm run build`). Close any Leviathan running from `dist/` first, or the build can't overwrite its files.
- Features are built test-first; every git operation has integration tests against real repositories, and UI changes are checked by driving the built app with Playwright's Electron support.
