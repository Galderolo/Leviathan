import { lfsPatternFor, type LfsLock, type LfsPattern } from '../../shared/lfs'
import type { DiffSource, FileChange, GitRef, PullRequest, Stash, Submodule } from '../../shared/types'
import {
  applyStash,
  checkoutAndMerge,
  checkoutCommit,
  checkoutPullRequest,
  closePullRequest,
  checkoutRef,
  cherryPick,
  createBranch,
  createPullRequestFor,
  createTag,
  deleteBranch,
  deleteRemoteBranch,
  deleteTag,
  discardAll,
  discardFiles,
  dropStash,
  hideInGraph,
  ignorePattern,
  lockFiles,
  makeLockable,
  mergeRef,
  openExternal,
  openBlame,
  openFile,
  openInDiffTool,
  openInEditor,
  openInMergeTool,
  openFileHistory,
  openInteractiveRebase,
  openReview,
  openSubmodule,
  openSubmoduleFolder,
  popStash,
  pullBranch,
  stashFiles,
  push,
  pushTag,
  rebaseOnto,
  removeRemote,
  renameBranch,
  resetTo,
  revertCommit,
  showFileInFolder,
  showInGraph,
  soloInGraph,
  stageFiles,
  stashChanges,
  trackLfsPattern,
  unlockFile,
  unstageFiles,
  updateSubmodules,
  untrackLfsPattern
} from './actions'
import { dropActions } from './dragDrop'
import { t } from './i18n'
import { lockFor } from './lfsView'
import { getRepo, useStore, type MenuItem } from './store'
import { copyText } from './ui'

function current(path: string): { branch: string | null; head: string | null } {
  const head = getRepo(path)?.state?.head
  return { branch: head?.branch ?? null, head: head?.hash ?? null }
}

export function commitMenu(path: string, hash: string): MenuItem[] {
  const { branch, head } = current(path)
  const target = branch ?? 'HEAD'
  const isHead = hash === head
  return [
    { label: t('menu.createBranchHere'), onClick: () => void createBranch(path, hash) },
    { label: t('menu.createTagHere'), onClick: () => void createTag(path, hash) },
    { label: t('menu.checkoutCommit'), disabled: isHead, onClick: () => void checkoutCommit(path, hash) },
    { separator: true },
    { label: t('menu.cherryPick'), disabled: isHead, onClick: () => void cherryPick(path, hash) },
    { label: t('menu.revert'), onClick: () => void revertCommit(path, hash) },
    {
      label: t('menu.interactiveRebase'),
      disabled: isHead,
      onClick: () => void openInteractiveRebase(path, hash)
    },
    { separator: true },
    {
      label: t('menu.resetSoft', { branch: target }),
      disabled: isHead,
      onClick: () => void resetTo(path, hash, 'soft')
    },
    {
      label: t('menu.resetMixed', { branch: target }),
      disabled: isHead,
      onClick: () => void resetTo(path, hash, 'mixed')
    },
    { label: t('menu.resetHard', { branch: target }), danger: true, onClick: () => void resetTo(path, hash, 'hard') },
    { separator: true },
    { label: t('menu.copySha'), onClick: () => void copyText(hash, t('toast.copied')) }
  ]
}

export function pullRequestMenu(path: string, pr: PullRequest): MenuItem[] {
  return [
    { label: t('menu.reviewPr'), onClick: () => openReview(path, pr) },
    { label: t('menu.openPr'), onClick: () => openExternal(pr.url) },
    { label: t('menu.checkoutPr'), onClick: () => void checkoutPullRequest(path, pr) },
    { separator: true },
    { label: t('menu.copyPrLink'), onClick: () => void copyText(pr.url, t('toast.copied')) },
    { separator: true },
    { label: t('menu.closePr'), danger: true, onClick: () => void closePullRequest(path, pr) }
  ]
}

export function branchMenu(path: string, ref: GitRef): MenuItem[] {
  const { branch } = current(path)
  const items: MenuItem[] = []
  if (ref.type === 'head') {
    items.push({
      label: t('menu.checkoutBranch', { name: ref.name }),
      disabled: ref.isHead,
      onClick: () => void checkoutRef(path, ref)
    })
  } else {
    items.push({ label: t('menu.checkoutBranch', { name: ref.name }), onClick: () => void checkoutRef(path, ref) })
  }
  if (branch && !ref.isHead) {
    items.push(
      { separator: true },
      { label: t('menu.merge', { name: ref.name, current: branch }), onClick: () => void mergeRef(path, ref.name) },
      { label: t('menu.rebase', { name: ref.name, current: branch }), onClick: () => void rebaseOnto(path, ref.name) }
    )
  }
  items.push({ separator: true })
  if (ref.type === 'head') {
    if (getRepo(path)?.pullRequests?.remote) {
      items.push({ label: t('menu.createPr'), onClick: () => void createPullRequestFor(path, ref) })
    }
    // The checked-out branch is pulled from the toolbar; any other one can be fast-forwarded in place.
    if (!ref.isHead && ref.upstream) {
      items.push({ label: t('menu.pullBranch', { name: ref.name }), onClick: () => void pullBranch(path, ref) })
    }
    items.push(
      { label: t('menu.pushBranch', { name: ref.name }), onClick: () => void push(path, { branch: ref.name }) },
      { label: t('menu.rename', { name: ref.name }), onClick: () => void renameBranch(path, ref) },
      {
        label: t('menu.delete', { name: ref.name }),
        danger: true,
        disabled: ref.isHead,
        onClick: () => void deleteBranch(path, ref)
      }
    )
  } else {
    items.push({
      label: t('menu.deleteRemote', { name: ref.name }),
      danger: true,
      onClick: () => void deleteRemoteBranch(path, ref)
    })
  }
  const scope = getRepo(path)?.graphScope
  const hidden = scope?.hidden.includes(ref.fullName)
  items.push(
    { separator: true },
    hidden
      ? { label: t('menu.showInGraph'), onClick: () => showInGraph(path, ref) }
      : { label: t('menu.hideInGraph'), disabled: ref.isHead, onClick: () => hideInGraph(path, ref) },
    { label: t('menu.soloInGraph'), onClick: () => soloInGraph(path, ref) },
    { separator: true },
    { label: t('menu.createBranchHere'), onClick: () => void createBranch(path, ref.hash) },
    { label: t('menu.createTagHere'), onClick: () => void createTag(path, ref.hash) },
    { label: t('menu.copyName'), onClick: () => void copyText(ref.name, t('toast.copied')) }
  )
  return items
}

/** Menu shown when one ref is dropped onto another. */
export function dropMenu(path: string, source: GitRef, target: GitRef): MenuItem[] {
  return dropActions(source, target, current(path).branch).map((action): MenuItem => {
    switch (action.kind) {
      case 'merge':
        return {
          label: t('menu.merge', { name: action.from, current: action.into }),
          onClick: () => void mergeRef(path, action.from)
        }
      case 'rebase':
        return {
          label: t('menu.rebase', { name: action.onto, current: action.branch }),
          onClick: () => void rebaseOnto(path, action.onto)
        }
      case 'checkoutMerge':
        return {
          label: t('menu.checkoutMerge', { into: action.into, from: action.from }),
          onClick: () => void checkoutAndMerge(path, action.into, action.from)
        }
    }
  })
}

export function tagMenu(path: string, ref: GitRef): MenuItem[] {
  return [
    { label: t('menu.checkoutBranch', { name: ref.name }), onClick: () => void checkoutRef(path, ref) },
    { label: t('menu.pushTag', { name: ref.name }), onClick: () => void pushTag(path, ref.name) },
    { separator: true },
    { label: t('menu.deleteTag', { name: ref.name }), danger: true, onClick: () => void deleteTag(path, ref.name) },
    { label: t('menu.copyName'), onClick: () => void copyText(ref.name, t('toast.copied')) }
  ]
}

export function refMenu(path: string, ref: GitRef): MenuItem[] {
  return ref.type === 'tag' ? tagMenu(path, ref) : branchMenu(path, ref)
}

export function stashMenu(path: string, stash: Stash): MenuItem[] {
  return [
    { label: t('menu.stashApply'), onClick: () => void applyStash(path, stash) },
    { label: t('menu.stashPop'), onClick: () => void popStash(path, stash) },
    { separator: true },
    { label: t('menu.stashDrop'), danger: true, onClick: () => void dropStash(path, stash) }
  ]
}

export function wipMenu(path: string): MenuItem[] {
  return [
    { label: t('menu.stashChanges'), onClick: () => void stashChanges(path) },
    { label: t('menu.discardAll'), danger: true, onClick: () => void discardAll(path) }
  ]
}

export function remoteMenu(path: string, name: string): MenuItem[] {
  return [{ label: t('menu.removeRemote', { name }), danger: true, onClick: () => void removeRemote(path, name) }]
}

/** Menu for several selected files: what applies to all of them at once. */
export function filesMenu(path: string, files: FileChange[], area: 'unstaged' | 'staged'): MenuItem[] {
  const count = files.length
  const copy = {
    label: t('menu.copyPaths'),
    onClick: () => void copyText(files.map((f) => f.path).join('\n'), t('toast.copied'))
  }
  const lfs = getRepo(path)?.lfs
  const unlocked = files.filter((f) => !lockFor(lfs?.locks, f.path)).map((f) => f.path)
  const lock: MenuItem[] =
    lfs?.info.used && lfs.info.version
      ? [
          {
            label: t('lfs.lockFiles', { count: unlocked.length }),
            disabled: !unlocked.length,
            onClick: () => void lockFiles(path, unlocked)
          },
          { separator: true }
        ]
      : []
  if (area === 'staged') {
    return [
      { label: t('menu.unstageCount', { count }), onClick: () => void unstageFiles(path, files) },
      { label: t('menu.stashCount', { count }), onClick: () => void stashFiles(path, files) },
      { separator: true },
      ...lock,
      copy
    ]
  }
  return [
    { label: t('menu.stageCount', { count }), onClick: () => void stageFiles(path, files) },
    { label: t('menu.stashCount', { count }), onClick: () => void stashFiles(path, files) },
    { label: t('menu.discardCount', { count }), danger: true, onClick: () => void discardFiles(path, files) },
    { separator: true },
    ...lock,
    copy
  ]
}

/** Lock, unlock and track items for a file, in a repository that uses Git LFS. */
function lfsFileItems(
  path: string,
  file: FileChange,
  area: 'unstaged' | 'staged' | 'conflicted' | 'commit'
): MenuItem[] {
  const view = getRepo(path)
  const lfs = view?.lfs
  if (!lfs?.info.version) return []
  const items: MenuItem[] = []
  // A repository that does not use LFS yet can start from here; locks only make sense once it does.
  if (lfs.info.used) {
    const lock = lockFor(lfs.locks, file.path)
    if (!lock) items.push({ label: t('lfs.lockFile'), onClick: () => void lockFiles(path, [file.path]) })
    else items.push(...lockItems(path, lock))
  }
  if ((area === 'unstaged' || area === 'staged') && file.status !== 'D' && !view?.state?.lfsFiles.includes(file.path)) {
    const pattern = lfsPatternFor(file.path)
    items.push({ label: t('lfs.trackPattern', { pattern }), onClick: () => void trackLfsPattern(path, pattern) })
  }
  if (items.length) items.push({ separator: true })
  return items
}

function lockItems(path: string, lock: LfsLock): MenuItem[] {
  if (lock.mine) return [{ label: t('lfs.unlockFile'), onClick: () => void unlockFile(path, lock) }]
  return [
    {
      label: t(lock.mine === false ? 'lfs.forceUnlockOf' : 'lfs.unlockOf', { owner: lock.owner }),
      danger: lock.mine === false,
      onClick: () => void unlockFile(path, lock)
    }
  ]
}

export function lockMenu(path: string, lock: LfsLock): MenuItem[] {
  return [
    ...lockItems(path, lock),
    { separator: true },
    { label: t('menu.copyPath'), onClick: () => void copyText(lock.path, t('toast.copied')) }
  ]
}

export function lfsPatternMenu(path: string, pattern: LfsPattern): MenuItem[] {
  const items: MenuItem[] = []
  // git-lfs writes to the root attributes file: a pattern of a nested one would be duplicated there.
  if (!pattern.lockable && pattern.source === '.gitattributes') {
    items.push({ label: t('lfs.makeLockable'), onClick: () => void makeLockable(path, pattern) })
  }
  items.push({ label: t('lfs.untrack'), danger: true, onClick: () => void untrackLfsPattern(path, pattern) })
  return items
}

export function fileMenu(
  path: string,
  file: FileChange,
  area: 'unstaged' | 'staged' | 'conflicted' | 'commit',
  /** For a file of a commit: that commit. */
  hash?: string
): MenuItem[] {
  const items: MenuItem[] = []
  if (area === 'unstaged') {
    items.push(
      { label: t('wip.stage'), onClick: () => void stageFiles(path, [file]) },
      { label: t('menu.stashFile'), onClick: () => void stashFiles(path, [file]) },
      { label: t('menu.discard'), danger: true, onClick: () => void discardFiles(path, [file]) },
      { separator: true }
    )
    if (file.status === '?') {
      const name = file.path.split('/').pop() ?? file.path
      const ext = name.includes('.') ? name.split('.').pop() : null
      items.push({
        label: t('menu.ignore', { name: file.path }),
        onClick: () => void ignorePattern(path, `/${file.path}`)
      })
      if (ext) items.push({ label: t('menu.ignoreExt', { ext }), onClick: () => void ignorePattern(path, `*.${ext}`) })
      items.push({ separator: true })
    }
  } else if (area === 'staged') {
    items.push(
      { label: t('wip.unstage'), onClick: () => void unstageFiles(path, [file]) },
      { label: t('menu.stashFile'), onClick: () => void stashFiles(path, [file]) },
      { separator: true }
    )
  } else if (area === 'conflicted') {
    items.push({ label: t('wip.markResolved'), onClick: () => void stageFiles(path, [file]) }, { separator: true })
  }
  const editor = !!useStore.getState().settings.editor.trim()
  if (editor && file.status !== 'D') {
    items.push({ label: t('tools.openInEditor'), onClick: () => openInEditor(path, file.path) })
  }
  if (area === 'conflicted') {
    items.push({ label: t('tools.openInMergeTool'), onClick: () => openInMergeTool(path, file.path) })
  } else if (file.status !== '?') {
    const source: DiffSource =
      area === 'commit'
        ? { kind: 'commit', hash: hash ?? '', parent: parentOf(path, hash), path: file.path, oldPath: file.origPath }
        : { kind: area, path: file.path }
    items.push({ label: t('tools.openInDiffTool'), onClick: () => openInDiffTool(path, source) })
  }
  if (area !== 'commit' || file.status !== 'D') {
    items.push(
      { label: t('menu.openFile'), onClick: () => openFile(path, file.path) },
      { label: t('menu.showInFolder'), onClick: () => showFileInFolder(path, file.path) }
    )
  }
  // A new file has no history yet; a deleted one has no lines left to blame.
  const isNew = file.status === '?'
  if (items.length) items.push({ separator: true })
  items.push(
    {
      label: t('menu.fileHistory'),
      disabled: isNew,
      onClick: () => openFileHistory(path, file.path, area === 'commit' ? (hash ?? null) : null)
    },
    {
      label: t('menu.blame'),
      disabled: isNew || file.status === 'D',
      onClick: () => openBlame(path, file.path, area === 'commit' ? (hash ?? null) : null)
    },
    { separator: true }
  )
  items.push(...lfsFileItems(path, file, area))
  items.push({ label: t('menu.copyPath'), onClick: () => void copyText(file.path, t('toast.copied')) })
  return items
}

export function submoduleMenu(path: string, sub: Submodule): MenuItem[] {
  return [
    {
      label: t(sub.state === 'uninitialized' ? 'sub.init' : 'sub.update'),
      disabled: sub.state === 'clean' || sub.state === 'conflict',
      onClick: () => void updateSubmodules(path, [sub])
    },
    { separator: true },
    { label: t('sub.open'), disabled: sub.state === 'uninitialized', onClick: () => void openSubmodule(path, sub) },
    { label: t('sub.openFolder'), onClick: () => openSubmoduleFolder(path, sub) },
    { separator: true },
    { label: t('menu.copyPath'), onClick: () => void copyText(sub.path, t('toast.copied')) }
  ]
}

/** First parent of a commit shown in the side panel's details (null for the first commit). */
function parentOf(path: string, hash: string | undefined): string | null {
  const details = getRepo(path)?.details
  return details && details.commit.hash === hash ? (details.commit.parents[0] ?? null) : null
}
