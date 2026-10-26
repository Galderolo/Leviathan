# Roadmap

Leviathan 0.1 covers the everyday workflow: clone, browse history, stage, commit, branch, merge, pull and push. This page lists ideas for what could come next. There are no dates: the project is maintained in spare time, and the order depends on what the maintainer needs and what contributors send. If you want to work on an item, open an issue first (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

Items marked **good first issue** are self-contained and a nice way to learn the codebase.

## Graph and history

- [x] Optional avatars from GitHub and Gravatar (off by default for privacy)
- [x] Blame of an older version from a line ("blame before this commit")
- [x] File history for a folder
- [ ] Column chooser for the graph (hide author, date or SHA) — **good first issue**
- [x] Resizable BRANCH / TAG and GRAPH columns, sideways scrolling of wide graphs

## Working tree

- [x] Syntax highlighting in diffs
- [x] Edit the result of a conflict by hand inside the conflict editor
- [x] Commit message templates (git's `commit.template`)

## History editing

- [x] Drag and drop to reorder commits in the interactive rebase dialog
- [ ] Interactive rebase of ranges with merge commits (`--rebase-merges`)
- [x] Stop at a commit to amend it (`edit`) during an interactive rebase

## Remotes and collaboration

- [x] Sign in to GitLab.com from the browser
- [ ] Sign in to GitHub Enterprise and self-managed GitLab from the browser (each server needs its own application)
- [x] Bitbucket Cloud accounts and pull requests
- [x] Review pull requests in the app (diff, comments, approve, merge)
- [x] Submodule support in the side panel
- [x] Git LFS: tracked files, locks, patterns, large-file warnings

## Application

- [ ] More languages (French, Portuguese, German, Italian...) — **good first issue**
- [x] Open the app with a repository path from the command line (`leviathan .`)
- [x] Configurable external editor and diff/merge tool
- [x] Configurable terminal
- [x] Pick the commit identity of a repository in the commit box; by default, the account that owns it or may push to it
- [ ] Profiles: different author name/email per repository group
- [ ] Code signing for Windows and macOS releases
- [ ] Auto-update on macOS (needs code signing)
- [x] End-to-end UI tests with Playwright (in CI)
