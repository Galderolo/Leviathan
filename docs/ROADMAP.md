# Roadmap

Leviathan 0.1 covers the everyday workflow: clone, browse history, stage, commit, branch, merge, pull and push. This page lists ideas for what could come next. There are no dates: the project is maintained in spare time, and the order depends on what the maintainer needs and what contributors send. If you want to work on an item, open an issue first (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

Items marked **good first issue** are self-contained and a nice way to learn the codebase.

## Graph and history

- [ ] Drag a branch label onto another to merge or rebase (as in other visual clients)
- [ ] Optional Gravatar avatars (off by default for privacy)
- [ ] Show/hide branches in the graph; solo a branch
- [ ] File history and blame view
- [ ] Column chooser for the graph (hide author, date or SHA) — **good first issue**
- [ ] Resizable BRANCH / TAG column — **good first issue**
- [ ] Highlight the commits of the selected branch

## Working tree

- [ ] Stage and unstage individual lines, not only hunks
- [ ] Side-by-side (split) diff view
- [ ] Word-level highlighting inside changed lines
- [ ] Syntax highlighting in diffs
- [ ] Built-in merge conflict editor (ours / theirs / result)
- [ ] Multi-select files to stage, unstage or discard together
- [ ] Commit message templates and co-author trailers — **good first issue**

## History editing

- [ ] Interactive rebase (reorder, squash, reword, drop) with drag and drop
- [ ] Undo / redo for the last operation (checkout, commit, reset...)
- [ ] Edit the message of any commit (reword)

## Remotes and collaboration

- [ ] Automatic background fetch at a configurable interval
- [ ] Pull request list for GitHub / GitLab / Gitea / Bitbucket via personal access tokens
- [ ] Submodule support in the side panel
- [ ] Git LFS status
- [ ] Choose the remote when pushing a new branch and several remotes exist — **good first issue**

## Application

- [ ] Light theme and theme switcher — **good first issue** (all colours are CSS variables)
- [ ] More languages (French, Portuguese, German, Italian...) — **good first issue**
- [ ] Open the app with a repository path from the command line (`leviathan .`)
- [ ] Configurable external editor, terminal and diff tool
- [ ] Profiles: different author name/email per repository group
- [ ] Code signing for Windows and macOS releases
- [ ] Auto-update from GitHub releases
- [ ] End-to-end UI tests with Playwright
