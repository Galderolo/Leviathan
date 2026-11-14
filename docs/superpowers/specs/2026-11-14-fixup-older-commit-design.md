# Fixup: add the staged changes to an older commit

Date: 2026-11-14. Status: design approved, plan next.

## Goal

From a commit's context menu, meld what is staged into that commit, wherever it is on the current branch, in one
click: no dialog with a list, no editor. Git's own `commit --fixup` and `rebase --autosquash` do the work.

Out of scope for v1: dragging staged files onto a commit, ranges with merges, ranges holding other `fixup!` /
`squash!` / `amend!` commits (all refused, pointing to the interactive rebase).

## What the user sees

- **Menu item** in `commitMenu` (`src/renderer/src/menus.ts`), next to *Interactive rebase from here…*:
  "Fixup: add staged changes here" / "Fixup: añadir los cambios staged aquí". Shown only when something is staged and
  no operation (merge, rebase, cherry-pick, revert, bisect) is under way. HEAD itself is a valid target.
- **Checked on click**, like *Interactive rebase from here…*. Refusals are an error toast:
  - the commit is not an ancestor of HEAD: "not on the current branch";
  - there is a merge between the commit and HEAD: refused, pointing to *Interactive rebase from here…*;
  - a commit from the target to HEAD has a subject starting with `fixup! `, `squash! ` or `amend! `: refused, pointing
    to *Interactive rebase from here…* (`--autosquash` would meld those as well, and a `squash!` would change a
    message).
- **Published commits:** when commits to be rewritten are already on a remote, a confirmation first: "This rewrites N
  commits that are already on the remote. Pushing them afterwards needs Force push." Nothing is pushed on its own, as
  after amending a pushed commit.
- **Done:** toast `Changes added to "<subject>"`, and the rewritten commit is selected in the graph.
- **Unstaged changes** are set aside and come back without a word (git's `--autostash`), also after a conflict is
  continued or aborted. Untracked files are not touched.
- **Conflict:** the usual rebase banner (Continue / Abort) and conflict editor. *Abort* leaves everything as before:
  HEAD, the staged changes (staged again) and the unstaged ones.
- **Undo:** one step back to before, the changes staged again. Redo does it again.
- **Signing fails** (key missing or locked): the same offer as a normal commit, "Commit unsigned"; if taken, the
  rebase does not sign the rewritten commits either.

## Main process

New module `src/main/git/fixup.ts` (`repository.ts` is over 2000 lines). It needs a few helpers that are private in
`repository.ts` today (`run`, `gitDir`, `currentOperation`, `hasHead`): they get exported.

### `fixupInfo(repo, target)`

Returns `{ ok: true, subject, published } | { ok: false, reason }`, `reason` one of `operation`, `nothingStaged`,
`notAncestor`, `merges`, `pendingFixups`. The renderer turns the reason into a translated message.

- `operation`: `currentOperation(repo)` is not null.
- `nothingStaged`: `git diff --cached --quiet` exits 0.
- `notAncestor`: `git merge-base --is-ancestor <target> HEAD` exits 1.
- `merges`: `git rev-list --merges <target>..HEAD` is not empty.
- `pendingFixups`: a subject in `<base>..HEAD` starts with `fixup! `, `squash! ` or `amend! `.
- `<base>` is `<target>^`, or nothing for a root commit (the range is then all of `HEAD`).
- `published` = `rev-list --count <range>` minus `rev-list --count <range> --not --remotes`. `RepoState.unpushed` is
  not used: it stops at 500 commits and is empty without remotes.

### `fixupCommit(repo, target, noSign)`

Returns `{ hash }`, the rewritten target, when it is done; throws otherwise.

1. Runs the `fixupInfo` checks again (the repository may have changed between the click and the confirmation); a
   refusal throws.
2. Notes `n` = `rev-list --count <target>..HEAD` and `origHead` = HEAD.
3. `git commit -q --fixup=<target>`, plus `--no-gpg-sign` when `noSign`. It goes through the user's hooks and
   signing like any commit. When it fails (a hook says no, signing fails) nothing has changed: the error is thrown as
   it is, so the renderer can tell a signing failure as `commit` does.
4. `git rebase -i --autosquash --autostash [--no-gpg-sign] <target>^` (`--root` for a root target), with
   `GIT_SEQUENCE_EDITOR=true` set explicitly: a `sequence.editor` in the user's config would win over the app's
   `GIT_EDITOR=true`. Everything else is git's own behaviour with the user's config (`rebase.updateRefs` moves the
   other branches that point into the range; `post-rewrite` hooks run).
5. **The rebase did not start** (it failed and no rebase is under way, such as a `pre-rebase` hook saying no): when
   HEAD is still the fixup commit, `git reset --soft <origHead>` (the staged changes are staged again), then the error
   is thrown.
6. **The rebase stopped** (a conflict, or anything else that leaves it under way): the fixup commit's hash is written
   to `<git-path rebase-merge>/leviathan-fixup`, then the error is thrown. Git deletes that folder when the rebase
   ends, however it ends (here or in a terminal), so the mark never outlives the rebase.
7. **Done:** a safety check that git really melded the fixup commit: the range from `<base>` to HEAD (all of HEAD
   for a root target) must hold `n + 1` commits, the target and the `n` after it. With `n + 2` the fixup commit was
   kept as a commit of its own (autosquash matched nothing): `git reset --soft <origHead>` puts everything back as
   before (the final tree is the same, so the index is old HEAD + staged again) and it throws "git could not add the
   changes to that commit". Otherwise it returns `HEAD~n`.

### Abort

`git rebase --abort` goes back to where the rebase started, which is the fixup commit, with the staged changes inside
it. `abortOperation` (`repository.ts`) reads `rebase-merge/leviathan-fixup` before aborting; after the abort, when
HEAD is that commit, `git reset --soft HEAD~1`. The index and the files are then exactly as before (the autostash has
already brought the unstaged changes back).

A rebase aborted in a terminal is not repaired: the app's refresh never writes to the repository, which could clash
with what the user is doing there. The `fixup! …` commit stays, which is what git leaves, and Undo takes it away.

### IPC

`fixupInfo` and `fixupCommit` added to `src/shared/api.ts` (the interface and the list of methods) and
`src/main/ipc.ts`.

## Renderer

`fixupInto(path, hash)` in `src/renderer/src/actions.ts`:

1. An operation under way: error toast, as `openInteractiveRebase`.
2. `api.fixupInfo`; a refusal: error toast with its message.
3. `published > 0`: `confirmDialog` with the count; cancelled, nothing happens.
4. `runOp(path, () => api.fixupCommit(path, hash, noSign), { undo: { label: t('undo.fixup', { name: subject }),
   mode: 'soft', stashes: false }, quiet })`, as `commit` does. `quiet` catches a signing failure (`signingFailed`,
   signing not turned off for the repository), which offers "Commit unsigned" with the same dialog as `commit` and
   runs again with `noSign`.
5. Done: `toast('success', t('toast.fixupDone', { name: subject }))`, refresh, select `hash`.
6. Stopped: the banner takes over (`runOp`'s handling of a stopped operation); `settleStoppedAction` records it once
   it is over. Aborted, nothing is recorded (the state is the one before).

### Undo

- Mode `soft`: undoing moves the branch back to the old HEAD and keeps the index, which is then old HEAD + staged:
  the state before. `keep` would drop the staged changes.
- **Stashes are left alone.** When a conflict was resolved differently, the autostash may not apply at the end: git
  then keeps it in the stash list as "autostash". Today the undo would drop a stash the action brought, and with it
  the unstaged changes. `runOp`'s `undo` and `recordUndo` get an option, `stashes: false`, to leave the stash list
  out of what they record (carried in `StoppedAction` for a stopped one). When it leaves out a stash that came, the existing `toast.changesWaitInStash`
  says where the changes are.

### Strings (en / es)

- `menu.fixupHere`: "Fixup: add staged changes here" / "Fixup: añadir los cambios staged aquí"
- `dlg.fixupPublishedTitle`, `dlg.fixupPublished` (with the count), confirm button "Add the changes" / "Añadir los
  cambios"
- `toast.fixupDone`: `Changes added to "{name}"` / `Cambios añadidos a "{name}"`
- `undo.fixup`: `fixup into "{name}"` / `fixup en "{name}"`
- `error.fixup.notAncestor`, `error.fixup.merges`, `error.fixup.pendingFixups`, `error.fixup.nothingStaged` (an
  operation under way reuses `error.operationInProgress`)

## Tests

**Integration** (`tests/fixup.test.ts`, real repositories, as `tests/rebaseInteractive.test.ts`):

- fixup into HEAD~2: the target has the staged change, the later commits and every message are unchanged, no
  `fixup!` commit is left, nothing is staged, the hash returned is the rewritten target;
- unstaged changes and untracked files are where they were;
- into a root commit (`--root`), and into HEAD;
- every refusal (`operation`, `nothingStaged`, `notAncestor`, `merges`, `pendingFixups`) changes nothing;
- `published` with a bare remote holding part of the branch;
- a conflict with a later commit stops with a rebase under way and the mark written; `abortOperation` then leaves
  HEAD, the staged and the unstaged changes as before; resolving and `continueOperation` finishes it;
- a `pre-rebase` hook that says no: the fixup commit is gone, the changes are staged again;
- a `pre-commit` hook that says no: nothing changed;
- `sequence.editor = false` in the repository's config does not get in the way;
- signing: with `commit.gpgsign` on and a signing program that fails, `noSign` commits and rebases unsigned.

**Unit:** the undo record without stashes (`tests/undoStack.test.ts` or a new file for the helper).

**End to end** (`e2e/app.spec.ts`, driving the packaged app):

- menu on an older commit → toast, the commit selected and its diff holding the change; Undo → the changes staged
  again and HEAD as before;
- a commit already pushed → the confirmation with the count; Cancel changes nothing.

## Docs

- `CHANGELOG.md`, `[Unreleased]` → `### Added`: the new menu item, in the changelog's own style.
- `docs/STATUS.md`: the feature, next to the interactive rebase, with the code it lives in.
