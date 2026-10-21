# Roadmap

Leviathan 0.1 covers the everyday workflow: clone, browse history, stage, commit, branch, merge, pull and push. This page lists ideas for what could come next. There are no dates: the project is maintained in spare time, and the order depends on what the maintainer needs and what contributors send. If you want to work on an item, open an issue first (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

Items marked **good first issue** are self-contained and a nice way to learn the codebase.

## Graph and history

- [ ] Optional Gravatar avatars (off by default for privacy)
- [ ] Show/hide branches in the graph; solo a branch
- [ ] File history and blame view
- [ ] Column chooser for the graph (hide author, date or SHA) — **good first issue**
- [ ] Resizable BRANCH / TAG column — **good first issue**
- [ ] Highlight the commits of the selected branch

## Working tree

- [ ] Side-by-side (split) diff view
- [ ] Word-level highlighting inside changed lines
- [ ] Syntax highlighting in diffs
- [ ] Edit the result of a conflict by hand inside the conflict editor
- [ ] Multi-select files to stage, unstage or discard together
- [ ] Commit message templates — **good first issue**

## History editing

- [ ] Drag and drop to reorder commits in the interactive rebase dialog
- [ ] Interactive rebase of ranges with merge commits (`--rebase-merges`)
- [ ] Stop at a commit to amend it (`edit`) during an interactive rebase

## Remotes and collaboration

- [ ] Sign in to accounts with the browser (OAuth device flow) instead of a personal access token
- [ ] Pull request list for GitHub / GitLab / Gitea / Bitbucket via personal access tokens
- [ ] Submodule support in the side panel
- [ ] Git LFS status

## Application

- [ ] More languages (French, Portuguese, German, Italian...) — **good first issue**
- [ ] Open the app with a repository path from the command line (`leviathan .`)
- [ ] Configurable external editor, terminal and diff tool
- [ ] Profiles: different author name/email per repository group
- [ ] Code signing for Windows and macOS releases
- [ ] Auto-update from GitHub releases
- [ ] End-to-end UI tests with Playwright
