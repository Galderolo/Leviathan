# Roadmap

Leviathan 0.1 covers the everyday workflow: clone, browse history, stage, commit, branch, merge, pull and push. This page lists ideas for what could come next. There are no dates: the project is maintained in spare time, and the order depends on what the maintainer needs and what contributors send. If you want to work on an item, open an issue first (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

Items marked **good first issue** are self-contained and a nice way to learn the codebase.

## Graph and history

- [ ] Optional Gravatar avatars (off by default for privacy)
- [ ] Blame of an older version from a line ("blame before this commit")
- [ ] File history for a folder
- [ ] Column chooser for the graph (hide author, date or SHA) — **good first issue**
- [ ] Resizable BRANCH / TAG column — **good first issue**

## Working tree

- [ ] Syntax highlighting in diffs
- [ ] Edit the result of a conflict by hand inside the conflict editor
- [ ] Commit message templates — **good first issue**

## History editing

- [ ] Drag and drop to reorder commits in the interactive rebase dialog
- [ ] Interactive rebase of ranges with merge commits (`--rebase-merges`)
- [ ] Stop at a commit to amend it (`edit`) during an interactive rebase

## Remotes and collaboration

- [ ] Sign in to GitLab and GitHub Enterprise from the browser (GitHub.com already works)
- [ ] Pull requests on Bitbucket
- [ ] Review pull requests in the app (diff, comments, approve, merge)
- [ ] Submodule support in the side panel
- [ ] Git LFS status

## Application

- [ ] More languages (French, Portuguese, German, Italian...) — **good first issue**
- [ ] Open the app with a repository path from the command line (`leviathan .`)
- [ ] Configurable external editor, terminal and diff tool
- [ ] Profiles: different author name/email per repository group
- [ ] Code signing for Windows and macOS releases
- [ ] Auto-update on macOS (needs code signing)
- [ ] End-to-end UI tests with Playwright
