import { parseRemotes } from '../shared/parsers'
import { projectNameProblem, type Published, type PublishInput } from '../shared/publish'
import * as accounts from './accounts'
import { createProject } from './accounts/providers'
import { readIdentity } from './git/identity'
import * as repo from './git/repository'
import { git } from './git/runner'

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
export async function publishRepository(path: string, input: PublishInput): Promise<Published> {
  if (!validInput(input)) throw new Error('Invalid repository to publish')
  const name = input.name.trim()
  if (projectNameProblem(name)) throw new Error(`Invalid repository name: "${name}"`)
  const { account, token } = await accounts.publishingAccount(input.accountId)
  if (account.provider === 'bitbucket' && !input.workspace) {
    throw new Error('Pick the Bitbucket workspace the repository goes to')
  }
  const { stdout } = await git(['remote', '-v'], { cwd: path })
  if (parseRemotes(stdout).some((r) => r.name === 'origin')) {
    throw new Error('This repository already has a remote named origin')
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
  try {
    await repo.addRemote(path, 'origin', created.cloneUrl)
  } catch (err) {
    throw new Error(
      `The project was created at ${created.webUrl}, but it could not be added as origin: ${message(err)}. Add it with Add remote.`
    )
  }
  // A repository with an identity of its own keeps it; one without takes the account's, as when it is opened.
  const { local } = await readIdentity(path).catch(() => ({ local: { name: '', email: '' } }))
  const bindError = await accounts
    .setRepoAccount(path, account.id, { keepIdentity: !!(local.name || local.email) })
    .then(
      () => null,
      (err: unknown) => message(err)
    )
  return { fullName: created.fullName, webUrl: created.webUrl, host: account.host, bindError }
}
