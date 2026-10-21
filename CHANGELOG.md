# Changelog

All notable changes to Leviathan are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com), and the project uses [semantic versioning](https://semver.org).

## [Unreleased]

### Added

- Stage and unstage individual lines.
- Drag a branch onto another to merge or rebase.
- In-app prompts for HTTPS credentials, SSH key passphrases and unknown host keys.
- SSH key list and generator in Settings.
- Automatic background fetch (every 10 minutes by default).
- Choose the remote when publishing a branch to a repository with several remotes.
- Light theme and theme selector.
- Graph drawn with rounded elbows and lane-coloured row bands.

### Fixed

- File names with glob characters (such as `[id].tsx`) no longer affect other files when staging or discarding.
- Pushing a branch created from another remote branch no longer pushes onto that branch.
- "Open file" no longer runs scripts or executables from a repository.
- Stash actions check that the stash list did not change in the meantime.
- Repositories with an orphan branch show their history; branch deletion works with translated git.
- Fixed a crash when git closed its input early, a race when staging hunks quickly, symlink previews and file names with spaces in diffs.

## [0.1.0] - 2026-10-21

First public version.

### Added

- Visual commit graph with coloured lanes, merge curves, branch/tag labels, avatars, WIP node and stashes.
- Repository tabs restored between sessions; open, clone and init repositories; recent repositories.
- Side panel with local branches (folder tree), remotes, stashes and tags, with ahead/behind counters and filter.
- Staging of files and individual hunks, discard, ignore, commit and amend.
- Diff viewer for working tree, index and commits.
- Branch operations: create, checkout, rename, delete, merge, rebase, push, delete on remote.
- History operations: cherry-pick, revert, reset (soft/mixed/hard), detached checkout, tags.
- Fetch, pull (ff / ff-only / rebase), push, force push with lease, remote management.
- Stash save/apply/pop/drop.
- Merge/rebase/cherry-pick/revert conflict banner with abort and continue.
- Commit search, live refresh on file changes, English and Spanish interface.
