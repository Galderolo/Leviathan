# Changelog

All notable changes to Leviathan are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com), and the project uses [semantic versioning](https://semver.org).

## [Unreleased]

### Changed

- *Set up Git LFS* asks first, and says that it adds the Git LFS settings to your user's Git configuration.
- The README has a code signing policy and a privacy policy, linked from every release.

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
