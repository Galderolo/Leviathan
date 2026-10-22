# Changelog

All notable changes to Leviathan are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com), and the project uses [semantic versioning](https://semver.org).

## [Unreleased]

## [0.9.2] - 2026-10-22

### Changed

- The graph column keeps room for several lanes even when the history is a straight line, instead of shrinking to one.

### Fixed

- No more "Cannot find latest.yml … 404" while a new version is still being published: until its installers are uploaded, there is simply no update yet.

## [0.9.1] - 2026-10-22

### Changed

- The SSH keys in Settings are folded away behind a *Show keys* button.
- The commit search and the side panel filter have an × to clear them (Esc clears them too).
- *Require locking before editing* (Git LFS) asks first: it makes matching files read-only at once.

### Fixed

- *Discard changes* on a submodule puts it back on the recorded commit (it did nothing); changes made inside a submodule are discarded from its own tab.
- Without git-lfs installed, the LFS section no longer offers to track patterns or shows "No locked files".
- One `.gitmodules` entry pointing outside the repository no longer hides every submodule.
- "Lock 1 files" now reads "Lock file".

## [0.9.0] - 2026-10-22

### Added

- What's new: the notes of every version, pre-releases included, from the GitHub releases (or the notes that came with the app when offline). Click the version in the status bar, or open it from Settings; it also opens once after an update.

### Fixed

- While a pull or a checkout writes files (LFS downloads included), they no longer show up as changes for a moment: refreshes wait until git releases the index.

### Changed

- New versions are noticed sooner: Leviathan looks for them every half hour, and when you come back to the app (at most every ten minutes), instead of every six hours.

## [0.8.1] - 2026-10-22

### Fixed

- After picking a branch in the side panel, a pull no longer dims the commits it brings: the highlight follows the branch as it moves.
- Submodules showed as not initialized when the repository's path was spelled differently from the one git reports (a symlinked folder, a Windows short name).

## [0.8.0] - 2026-10-22

### Added

- Submodules: a SUBMODULES section in the side panel shows each one's state (not initialized, other commit than the recorded one, changes inside), with *Update all*, *Initialize and update*, *Check out the recorded commit*, *Open in a new tab* (or double-click) and *Open folder*. A note says when submodules are not at the commits the branch records.
- The diff of a submodule lists the commits it brings in or takes away, instead of two commit hashes.
- Cloning includes submodules (an option in the clone form, on by default). A submodule that cannot be fetched no longer fails the clone: the repository opens with a warning.
- Updating a submodule refuses when the commits checked out in it are on no branch, instead of leaving them behind.

### Fixed

- Collapsed or expanded folders and sections of the side panel are kept when switching tabs, and after a restart.

## [0.7.0] - 2026-10-22

### Added

- `Ctrl+P` pushes and `Ctrl+L` pulls the current branch.
- "Push to origin/<branch> after committing" under the commit message: each commit is pushed right away (the choice is remembered).

### Changed

- *Set up Git LFS* asks first, and says that it adds the Git LFS settings to your user's Git configuration.
- The README has a code signing policy and a privacy policy, linked from every release.
- Much faster with big repositories (thousands of changed files, tens of thousands of files in a commit, thousands of branches):
  - File lists only draw the rows on screen: a commit with 35 000 files opens in a quarter of a second instead of freezing for two, and typing a commit message with 13 000 changed files no longer lags.
  - Ahead/behind counts are only worked out again for branches that moved (a refresh with 1 500 branches went from about a second to a tenth).
  - When `git status` gets slow because the index's file timestamps are stale (files copied, touched by other tools, or LFS files), Leviathan refreshes them, as `git status` in a terminal does.
  - Changes inside ignored folders (Unity's `Library/` and `Temp/`, build output…) no longer trigger refreshes, and changes that never stop still show up every two seconds.
  - Staging, committing and similar actions wait a moment when another Git program holds the index, instead of failing with "index.lock exists".

## [0.6.0] - 2026-10-22

### Added

- Git LFS: in repositories that use it, an LFS section in the side panel lists the tracked patterns and the locked files (yours and other people's), and files that go through LFS carry an LFS tag. Lock and unlock files from their menu; someone else's lock can be forced open after a confirmation. Track new patterns (optionally lockable) from the section or a file's menu, also in a repository that does not use LFS yet; files already staged that the new pattern covers are staged again through LFS. A file you changed that someone else locked is flagged in red, with a warning above the commit button.
- A staged file over 50 MB that is not in Git LFS gets a warning above the commit button (GitHub rejects files over 100 MB), with a button that tracks its extension with LFS and stages it again through LFS.
- Files that should go through Git LFS but were staged with their whole content (staged before their pattern existed, or without git-lfs) get a warning above the commit button, with a button that stages them through LFS. A file whose working copy changed since it was staged is never replaced: you are asked to stage it again instead.
- When a repository uses Git LFS but git-lfs is missing or not set up, the side panel says so, with a link to download it or a button that sets it up (`git lfs install`) and downloads the LFS files.

## [0.5.0] - 2026-10-22

### Added

- Graph: hide branches or show only one (right-click a branch; a bar above the graph shows all again), dim the commits outside the history of the branch picked in the side panel, and see which branches have an open pull request (#N on their labels).
- Automatic updates from the GitHub releases: shortly after start and every few hours Leviathan looks for a newer version and says so in the status bar. The Windows installer build and the Linux AppImage download and install it with one click (then restart); the portable .exe, the .deb package and macOS open the release page instead. Settings → Updates turns the checks off or runs one now.

## [0.4.0] - 2026-10-22

### Added

- Diffs highlight the words that changed inside each changed line, and can be shown side by side (old | new) with the switch in the diff header; the choice is remembered.
- File history and blame: right-click any file (unstaged, staged or in a commit). The history follows renames and shows the file's diff in each commit; blame shows who last changed each line, including lines not committed yet, and takes you to that commit in the graph.
- Close a pull request from its menu in the side panel (GitHub, GitLab, Gitea).
- Select several files in the unstaged or staged list (checkboxes, Ctrl+click, Shift+click for a range, or the header checkbox for all) and stage, unstage or discard them together; right-clicking a selection offers the same.
- Drag the divider between the unstaged and staged lists to give one of them more room; the position is remembered.
- Sign in with GitHub from Settings → Accounts: Leviathan shows a code, you enter it on GitHub in the browser and the account is added, no token to create. Organizations that restrict OAuth apps must approve Leviathan before their repositories are reachable with it.

### Fixed

- The pull request list reloads when accounts or remotes change; rows show source → target.
- Interactive rebase: a refused rebase keeps the dialog and what was typed; a stopped one shows a short message and the conflicted files; no shortcuts act behind the dialog or Settings; its temporary files are removed at the end.
- The open diff follows its file when it is staged or unstaged whole, and closes when the file has no changes left.
- Undo/redo messages for an action that can no longer apply say which one, translated.
- Adding an account that is already there (signing in again, or a new token) renews its token instead of adding it twice.
- Signing in and the token page ask for the `workflow` permission, without which GitHub refuses pushes that change files in `.github/workflows`.

## [0.3.1] - 2026-10-22

Same app as 0.3.0, released again so every platform has its installers.

### Fixed

- The macOS installers were missing from the 0.3.0 release.

## [0.3.0] - 2026-10-21

### Added

- Commits that are not pushed yet show a small arrow at the end of their message in the graph.

- Pull requests: the open pull requests (merge requests on GitLab) of the repository appear in the side panel when one of your accounts is on its remote; open, check out or copy the link of any of them, and create one from a branch (right-click it). Works with GitHub, GitLab and Gitea. GitLab tokens need the `api` scope to create merge requests.

- Pull a branch that is not checked out (right-click it: *Pull … (fast-forward)*), without switching to it.

- Interactive rebase: right-click a commit and reorder, reword, squash, fixup or drop the commits after it. A conflict stops the rebase with the usual banner and conflict editor. A rebase that finishes without stopping can be undone.

- Conflict editor: current and incoming versions side by side, per-block choices, whole-file sides (including deletions).

- Undo and redo (toolbar buttons, Ctrl+Z / Ctrl+Shift+Z) for commits, amends, checkouts, branch and tag changes, merges, rebases, cherry-picks, reverts, resets and pulls.

### Changed

- After a pull, the message names the branch that was pulled and says when it was already up to date, and the graph scrolls to the new tip.

## [0.2.0] - 2026-10-21

### Added

- Accounts: several GitHub, GitLab, Gitea or other accounts with encrypted personal access tokens. A repository bound to an account commits with its name and no-reply email and pushes/pulls with its token. Clone from an account's repository list.
- Fetch button in the toolbar.
- Choose the starting point when creating a branch.
- Branches, remote branches and tags show when they were last updated.
- A bar above commit details points back to uncommitted changes and the commit box.

### Fixed

- Esc closes Settings wherever the focus is.

## [0.1.0] - 2026-10-21

First public version.

### Added

- Visual commit graph with coloured lanes, rounded elbows, lane-coloured row bands, branch/tag labels, author initials, WIP node and stashes.
- Repository tabs restored between sessions; open, clone and init repositories; recent repositories.
- Side panel with local branches (folder tree), remotes, stashes and tags, with ahead/behind counters and filter.
- Staging of files, hunks and individual lines; discard, ignore, commit and amend.
- Diff viewer for working tree, index and commits.
- Branch operations: create, checkout, rename, delete, merge, rebase, push, delete on remote; drag a branch onto another to merge or rebase.
- History operations: cherry-pick, revert, reset (soft/mixed/hard), detached checkout, tags.
- Fetch, pull (ff / ff-only / rebase), push, force push with lease, remote management, remote choice when publishing a branch, automatic background fetch.
- Private repositories: in-app prompts for HTTPS credentials, SSH key passphrases and unknown host keys; SSH key list and generator.
- Stash save/apply/pop/drop.
- Merge/rebase/cherry-pick/revert conflict banner with abort and continue.
- Commit search, live refresh on file changes, dark and light themes, English and Spanish interface.
