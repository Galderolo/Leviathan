import type { Identity } from '../../shared/identity'
import { git } from './runner'

/** A git config value, or '' when it is not set. */
async function configValue(repo: string, scope: string[], key: string): Promise<string> {
  const { stdout, exitCode } = await git(['config', ...scope, '--get', key], { cwd: repo, okCodes: [0, 1] })
  return exitCode === 0 ? stdout.trim() : ''
}

/** The identity a repository sets itself (`local`), and the one git commits with there (`effective`). */
export async function readIdentity(repo: string): Promise<{ local: Identity; effective: Identity }> {
  const [localName, localEmail, name, email] = await Promise.all([
    configValue(repo, ['--local'], 'user.name'),
    configValue(repo, ['--local'], 'user.email'),
    configValue(repo, [], 'user.name'),
    configValue(repo, [], 'user.email')
  ])
  return { local: { name: localName, email: localEmail }, effective: { name, email } }
}

/** Gives a repository an identity of its own, or takes it away (`null`) so the global one applies. */
export async function writeIdentity(repo: string, identity: Identity | null): Promise<void> {
  if (identity) {
    await git(['config', '--local', 'user.name', identity.name], { cwd: repo })
    await git(['config', '--local', 'user.email', identity.email], { cwd: repo })
    return
  }
  // Exit code 5: it was not set.
  await git(['config', '--local', '--unset-all', 'user.name'], { cwd: repo, okCodes: [0, 5] })
  await git(['config', '--local', '--unset-all', 'user.email'], { cwd: repo, okCodes: [0, 5] })
}
