# Changelog

All notable changes to Leviathan are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com), and the project uses [semantic versioning](https://semver.org).

## [Unreleased]

### Added

- **Choose the graph's columns**: right-click its header to hide or show the author, date and SHA columns; the choice is kept for every repository.
- **Commit message template**: with git's `commit.template` set (for a repository or globally), the commit box starts from it — its first line as the summary, the rest as the description, without its comment lines — and again after each commit. As in git, the template left as it is cannot be committed, and *Amend* from it takes the last commit's message.

### Fixed

- Shift+click on a file's checkbox gives the whole range the state that checkbox takes: a range can now be unchecked that way too, not only checked.
- *Ignore* on a file whose name has `[`, `*`, `?` or a backslash (`pages/[id].tsx`) ignored other files its name matched as a pattern, not that one: the name is now written literally in .gitignore.
- A merge, cherry-pick, revert or rebase (by drag and drop or from a menu) that stops for something other than conflicts says what git found, without its hints about commands the app does not offer — as the interactive rebase already did.
- A conflicted file marked resolved from the list (its button or menu) left the conflict editor showing it; the staged result is shown instead. Going from the conflict editor to a plain diff in the same pane could also leave the window blank.

## [0.16.0] - 2026-10-26

### Added

- **Avatars**, off by default (*Settings → General*): the authors' pictures in the graph, commit details and histories, from the repository's server through your account (GitHub, GitLab, Bitbucket or Gitea), GitHub's private emails and Gravatar; the initials stay without one. Turning them on means asking those services about each author's email (the README says what goes where).
- **Blame before a change**: in a blame, the button on a commit's lines (or a line's right-click menu) opens the blame of the file as it was just before that commit, under the name it had then, at the place of that line. Go on back in time from there, and *Back* returns step by step.
- **Pick who a commit is by**: the commit box shows the identity the next commit will have (and where it comes from: an account, the repository, git's global configuration); a click picks an account's, one typed before, another one, or the global identity, for that repository only.
- **The right account by default**: a repository with no identity of its own, opened in the app, takes the identity of the account that owns it, or else of an account that may push to it (asked to GitHub, GitLab, Bitbucket or Gitea). An identity the repository already has is never replaced.
- **Edit a conflicted file by hand** in the conflict editor: *Edit by hand* opens the whole file as text, with the blocks you chose already resolved and the others still marked, to change anything in it (a block, or any other line). Saving warns if conflict markers are left, keeps the file's line endings, and marks it resolved.

### Changed

- Account tokens are encrypted and read with Electron's newer secure storage calls (the old ones are going away); tokens saved by earlier versions still open, and a token whose key the system rotated is encrypted again with the new one.
- Tabs with commits to pull or push are no longer tinted blue or green: the tint could pass for the tab showing. Only that one stands out; the ↓ and ↑ counts stay.

### Fixed

- A repository whose remote goes through an SSH alias (a `Host` in ~/.ssh/config, the usual way to use two accounts on one server, as in `git@github-work:org/app`) is matched to its account: its pull requests, its default commit identity and its authors' pictures work. The real host is read with `ssh -G`, which connects to nothing.

## [0.15.1] - 2026-10-26

### Security

- Generating an SSH key with a passphrase no longer puts the passphrase on ssh-keygen's command line, where other users of the computer could read it while the key was being made (Linux, macOS). ssh-keygen now asks the app for it; with an OpenSSH too old for that (before 8.4), no key is created and the app says why, rather than a key without the passphrase.

### Fixed

- File and folder history said nothing when they stopped at the latest 300 commits: they now say so, with *Show more* (up to 5 000). A blame cut at 20 000 lines says so too.
- A commit that only renamed a file shows "Renamed from …, with no other change" instead of "No changes to show".
- Typing into a dialog the moment it opened could lose its other fields (*Generate new key* then failed with "Cannot read properties of undefined").
- Dropping a branch onto another one that is not checked out, then *Checkout … and merge … into it*, asks first: it says which branch you will be left on, and that your uncommitted changes go along.
- *Take current file* and *Take incoming file* in the conflict editor ask first when the file was edited since git left it in conflict (by hand, or in an editor), instead of replacing those edits without a word.
- An interactive rebase that stops for something other than conflicts (an untracked file in the way, a step that failed) says what git found, instead of "usually for conflicts".
- A pull, push or fetch started while the automatic fetch was running could fail with "cannot lock ref" (or make the automatic fetch fail): it now waits for the automatic fetch to end. Checking out a pull request waits too.

## [0.15.0] - 2026-10-26

### Added

- **Reorder the tabs** by dragging them; the order is kept for the next start.
- **Whole file in diffs**: the new button next to the layout switch fills the space between hunks with the file's unchanged lines, to read a change in its context. Hunks keep their stage, unstage and discard buttons and line selection; works in one column and side by side, for the working tree, the index and commits. The choice is remembered.
- **Tabs show what is waiting on the remote**: the commits the checked-out branch has to pull (↓, blue) and to push (↑, green), the same counts as the Pull and Push buttons, on every tab and not only the one showing. A tab with something to pull is tinted blue, one with only something to push green.

## [0.14.0] - 2026-10-23

### Added

- **Folder history**: a file's menu → *Folder history* lists the commits that changed something in its folder; pick one to see the files it changed there and their diff. In any history or blame, the folders in the path at the top open their own history, to go up a level.
- **Choose your terminal** (Settings → External tools) for the *Terminal* button: Command Prompt, Windows PowerShell, PowerShell 7, Windows Terminal or Git Bash on Windows; Terminal, iTerm or Warp on macOS; GNOME Terminal, Konsole, Xfce Terminal, kitty, Alacritty or WezTerm on Linux; or any command. It opens in the repository's folder.

### Changed

- Merging a reviewed pull request offers only the methods the project allows (for example squash when it takes no merge commits), its default first: GitHub's merge settings, GitLab's squash setting, Bitbucket's merge strategies of the target branch, Gitea's merge styles.

### Fixed

- A pull request review leaves nothing behind once it ends: the ref that held its commits (`refs/leviathan/review/N`) is deleted.
- A review starts even when the ref of an earlier one is locked by another git.
- A terminal command with `{folder}` refuses, on Windows, a folder whose path has a `%` in it (cmd would have read it as a variable and opened another folder).

### Security

- Windows: a program placed at the root of a repository with the name of one the app starts (`git.exe`, `cmd.exe`, an editor's command) could run instead of it as soon as that repository was opened, because Windows looks in the working folder before the PATH. The app now turns that search off for itself and everything it starts, and starts editors, terminals and cmd by their full path.

## [0.13.0] - 2026-10-23

### Added

- **Review pull requests in the app** (GitHub, GitLab, Bitbucket, Gitea): a pull request's menu → *Review* shows its files and their diff (fetched with git: nothing is checked out and your branches are not touched) and its conversation, including comments on lines. Add a comment, approve it, and merge it on the server (merge commit, squash or rebase, as the provider allows).
- **Interactive rebase**: drag a commit by its grip to move it, and *Edit* stops at a commit so you can change it (edit the files, commit with *Amend previous commit*, then *Continue*).
- **Syntax highlighting in diffs** (changes, commits, file history), in both themes, with the changed words still marked. C#, shaders, Unity's YAML assets, USS/UXML, JavaScript/TypeScript, JSON, XML, Python, C/C++, Java, Kotlin, Go, Rust, Lua, shell, PowerShell, SQL and more; very large hunks stay plain so diffs open fast.

### Changed

- A push refused because the remote branch has commits that are not here yet ("fetch first") asks to pull them and push again, instead of showing git's hints.
- While a merge, rebase, cherry-pick or revert waits to be continued, the uncommitted changes row stays in the graph even with no changes, so its banner (*Continue*, *Abort*) is always at hand.
- The side panel stays quick with thousands of branches and tags: only the rows in view are drawn. With 4 500 refs, folding a section or typing in the filter took up to a second; now it takes a few tens of milliseconds.

### Fixed

- An account whose token stopped working (revoked or expired) says so in the pull requests section, with a link to Settings → Accounts, instead of only "GitHub rejected the token (401)".
- The editor presets find Rider, Visual Studio, Sublime Text, Notepad++, VS Code and Cursor where their installers put them when they are not on the PATH (Rider showed "rider was not found" although installed).
- Git LFS on a server without file locks (Bitbucket Cloud): the side panel says the server has no locks instead of showing git-lfs's "Repository or object not found" error, and the lock actions are hidden there.
- LFS patterns with spaces show them as spaces, not as `[[:space:]]`.

## [0.12.0] - 2026-10-23

### Added

- **Bitbucket Cloud accounts**: add one with an Atlassian API token (*Settings → Accounts → Add account*, the form lists the scopes it needs). Push and pull without passwords, clone from the repositories of your workspaces, and see, check out, open and decline pull requests. Commits use the account's primary email (Bitbucket has no no-reply address). Bitbucket Data Center servers can still be added as "Other".
- *Add to Bitbucket* next to the SSH keys.

### Changed

- Applying or popping a stash that changes files you have changed too says so (git refuses, to keep your changes) and offers *Stash mine and apply*: your changes to those files go into a stash of their own, then the stash you picked is applied.

### Fixed

- Choosing VS Code as the diff and merge tool failed with "Unknown merge tool vscode": git does not know VS Code by name, so Leviathan now tells it how to run it (its diff, and its three-way merge editor).

## [0.11.0] - 2026-10-23

### Added

- **Sign in with GitLab** (gitlab.com) from *Settings → Accounts*: allow Leviathan on the page that opens in the browser, no token to create. The sign-in renews itself in the background (GitLab's tokens last two hours).
- **Stash some files**: right-click a file (or several selected ones) in the uncommitted changes → *Stash this file* / *Stash N files*. The toolbar's Stash still stashes everything.

### Changed

- Settings is organized in sections (General, External tools, Accounts, SSH keys, Updates, About), and every change is saved at once: there is no Save button any more.
- GitLab accounts send their token as `Authorization: Bearer`, which takes both personal access tokens and the tokens of a GitLab sign-in.

## [0.10.0] - 2026-10-23

### Added

- **Open files in your editor**: pick VS Code, Cursor, Rider, Visual Studio, Sublime Text, Notepad++ or any command in *Settings → External tools*. Files open from their menu (from the diff, at the first changed line) and the repository from the repository menu.
- **Diff and merge tools**: show a file's change (uncommitted, staged or in a commit) in your diff tool, and resolve a conflicted file in your merge tool: the one set in git's config, or one picked in Settings.
- **`leviathan .` from a terminal** opens the repository of that folder, in a new tab of the open window. On Windows, *Settings → External tools → Add the leviathan command* puts it on your user PATH; on macOS and Linux, Settings shows the command that creates it.

### Changed

- Starting Leviathan while it is open brings the open window forward instead of opening a second one.
- Discarding several files asks with how many there are (and how many are new) instead of listing their paths, which made the dialog huge.

### Fixed

- Settings scrolls on short windows; its Save and Cancel buttons could end up off screen.

## [0.9.4] - 2026-10-23

### Changed

- After switching branches (or checking out a commit or a pull request), the uncommitted changes you brought along are shown; with none, the commit you are now on. A double-click on a branch used to leave its last commit on screen.

### Fixed

- A stash lists the untracked files it keeps (with the untracked icon) and shows their content; it used to say "0 files changed" for a stash of new files only.
- Applying or popping a stash whose untracked files already exist in the folder says so in one sentence (git leaves them as they are, applies the rest and keeps the stash) instead of listing git's messages file by file.
- The Push button counts the commits of a branch that was never pushed (the ones marked ↑ in the graph); it only showed a number once the branch had an upstream.
- A cherry-pick, revert, merge, rebase or pull that stops for conflicts no longer shows git's output as an error: a short note says what to do, and the changes view opens with the banner and the conflicted files.

## [0.9.3] - 2026-10-22

### Changed

- Drag the borders of the BRANCH / TAG and GRAPH column headers to resize them; the widths are remembered (the same in every repository) and a double-click on a border resets it.
- A graph wider than its column scrolls sideways instead of widening the column: a bar under it, Shift + wheel, or a trackpad's horizontal swipe.

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
