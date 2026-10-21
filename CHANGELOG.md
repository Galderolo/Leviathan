# Changelog

All notable changes to Leviathan are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com), and the project uses [semantic versioning](https://semver.org).

## [Unreleased]

### Added

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
