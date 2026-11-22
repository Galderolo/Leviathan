import { parseRemotes } from '../shared/parsers'
import { projectNameProblem, type Published, type PublishInput } from '../shared/publish'
import * as accounts from './accounts'
import { createProject } from './accounts/providers'
import { readIdentity } from './git/identity'
import * as repo from './git/repository'
import { git, repoKey } from './git/runner'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function validInput(input: PublishInput): boolean {
  return (
    !!input &&
    typeof input.accountId === 'string' &&
    typeof input.name === 'string' &&
    typeof input.description === 'string' &&
    typeof input.private === 'boolean' &&
    (input.workspace === undefined || typeof input.workspace === 'string')
  )
}

/**
 * Creates the project of a repository on one of the user's accounts, adds it as `origin` and binds the repository to
 * the account, so the push that follows goes through that account and no other stored credential. Nothing is
 * changed here when the server refuses; once the project exists, failing to bind the account is only reported.
 */
async function publish(path: string, input: PublishInput): Promise<Published> {
  if (!validInput(input)) throw new Error('Invalid repository to publish')
  const name = input.name.trim()
  if (projectNameProblem(name)) throw new Error(`Invalid repository name: "${name}"`)
  // Before anything that may go over the network (renewing the token).
  const { stdout } = await git(['remote', '-v'], { cwd: path })
  if (parseRemotes(stdout).some((r) => r.name === 'origin')) {
    throw new Error('This repository already has a remote named origin')
  }
  const { account, token } = await accounts.publishingAccount(input.accountId)
  if (account.provider === 'bitbucket' && !input.workspace) {
    throw new Error('Pick the Bitbucket workspace the repository goes to')
  }
  // Also on a branch with no commits yet; '' on a detached HEAD.
  const head = await git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: path, okCodes: [0, 1] })
  const created = await createProject(account.provider, account.host, token, {
    name,
    description: input.description.trim(),
    private: input.private,
    branch: head.stdout.trim(),
    workspace: input.workspace
  })
  // Only an HTTPS address becomes origin: a server answering http://, git:// or ssh:// would send the token's account
  // over a channel it did not choose. A value with no scheme at all (a plain path) passes: only test doubles give one.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(created.cloneUrl) && !/^https:\/\//i.test(created.cloneUrl)) {
    throw new Error(
      `The project was created at ${created.webUrl}, but the server gave no HTTPS address for it. Add it with Add remote.`
    )
  }
  try {
    await repo.addRemote(path, 'origin', created.cloneUrl)
  } catch (err) {
    throw new Error(
      `The project was created at ${created.webUrl}, but it could not be added as origin: ${message(err)}. Add it with Add remote.`
    )
  }
  // A repository with an identity of its own keeps it; one without takes the account's, as when it is opened. When
  // it cannot be read, nothing is overwritten.
  const local = await readIdentity(path).then(
    (identity) => identity.local,
    () => null
  )
  const bindError = await accounts
    .setRepoAccount(path, account.id, { keepIdentity: !local || !!(local.name || local.email) })
    .then(
      () => null,
      (err: unknown) => message(err)
    )
  return { fullName: created.fullName, webUrl: created.webUrl, host: account.host, bindError }
}

/** Repositories being published now. */
const publishing = new Set<string>()

export async function publishRepository(path: string, input: PublishInput): Promise<Published> {
  if (!validInput(input)) throw new Error('Invalid repository to publish')
  const key = repoKey(path)
  // The Welcome form opens the repository before its publish returns, so a Push in that moment would otherwise start
  // a second one.
  if (publishing.has(key)) throw new Error('This repository is being published already')
  publishing.add(key)
  try {
    return await publish(path, input)
  } finally {
    publishing.delete(key)
  }
}
