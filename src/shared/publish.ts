import type { Account } from './types'

/** What creating a project on a server takes. */
export interface NewProject {
  name: string
  description: string
  private: boolean
  /** The branch pushed first ('' on a detached HEAD): Gitea's default branch. */
  branch: string
  /** Bitbucket: the workspace the repository goes to. */
  workspace?: string
}

/** A project just created on a server. */
export interface CreatedProject {
  /** `owner/name` (GitLab: the whole namespace path). */
  fullName: string
  /** HTTPS address to add as `origin`, without a username in it. */
  cloneUrl: string
  /** The project's page. */
  webUrl: string
}

/** What the renderer asks for to publish a repository. */
export interface PublishInput {
  accountId: string
  name: string
  description: string
  private: boolean
  workspace?: string
}

/** A repository published: where its project is, and why it could not be given the account (null: it was). */
export interface Published {
  fullName: string
  webUrl: string
  host: string
  bindError: string | null
}

export type ProjectNameProblem = 'empty' | 'tooLong' | 'characters' | 'dotGit' | 'edge'

/** GitHub's limit, the lowest of the four servers. */
export const PROJECT_NAME_MAX = 100

/** Drops dots and dashes at the edges and a trailing `.git`, until none is left (`x-.git` → `x`). */
function tidy(name: string): string {
  let out = name
  for (;;) {
    const next = out.replace(/^[-.]+|[-.]+$/g, '').replace(/\.git$/i, '')
    if (next === out) return out
    out = next
  }
}

/**
 * A project name made from a folder name, one every server accepts: letters without their accents, digits, `.`, `-`
 * and `_`, every other run of characters one `-`. '' when nothing is left.
 */
export function projectName(folder: string): string {
  const name = folder
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
  return tidy(tidy(name).slice(0, PROJECT_NAME_MAX))
}

/** Why `name` cannot be a project's name, or null when it can. */
export function projectNameProblem(name: string): ProjectNameProblem | null {
  if (!name) return 'empty'
  if (name.length > PROJECT_NAME_MAX) return 'tooLong'
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'characters'
  if (/\.git$/i.test(name)) return 'dotGit'
  if (/^[-.]|[-.]$/.test(name)) return 'edge'
  return null
}

/** Bitbucket's slug of a repository name: the same characters, in lower case. */
export function bitbucketSlug(name: string): string {
  return name.toLowerCase()
}

/** Where a project will be, as the dialog shows it: `github.com/ana/game`, `bitbucket.org/team/game`. */
export function projectLocation(
  account: Pick<Account, 'provider' | 'host' | 'username'>,
  workspace: string,
  name: string
): string {
  return account.provider === 'bitbucket'
    ? `${account.host}/${workspace}/${bitbucketSlug(name)}`
    : `${account.host}/${account.username}/${name}`
}

/** Whether an account can create projects: "Other" has no API. */
export function canPublish(account: Pick<Account, 'provider'>): boolean {
  return account.provider !== 'other'
}
