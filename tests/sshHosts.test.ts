import { describe, expect, it } from 'vitest'
import { SshHosts } from '../src/main/git/sshHosts'
import type { Remote } from '../src/shared/types'

const remote = (url: string): Remote => ({ name: 'origin', fetchUrl: url, pushUrl: url })

/** `ssh -G` answers: the real host of each alias in a config, the name itself for the others. */
function fakeSsh(aliases: Record<string, string>) {
  const asked: string[] = []
  const run = async (host: string) => {
    asked.push(host)
    if (host === 'broken') throw new Error('ssh not found')
    return `user git\nhostname ${aliases[host] ?? host}\nport 22\n`
  }
  return { run, asked }
}

describe('SshHosts', () => {
  it('puts the real host of an SSH alias in remote URLs, as ssh would connect', async () => {
    const ssh = fakeSsh({ 'github-work': 'github.com', 'gl-alias': 'gitlab.example.com' })
    const hosts = new SshHosts(ssh.run)
    expect(
      await hosts.resolve([
        remote('git@github-work:studio/game.git'),
        remote('ssh://git@gl-alias:2222/group/sub/app.git'),
        remote('https://bitbucket.org/team/app.git')
      ])
    ).toEqual([
      remote('git@github.com:studio/game.git'),
      remote('ssh://git@gitlab.example.com:2222/group/sub/app.git'),
      remote('https://bitbucket.org/team/app.git')
    ])
    // HTTPS has no aliases: ssh is not asked about it.
    expect(ssh.asked.sort()).toEqual(['github-work', 'gl-alias'])
  })

  it('asks ssh about each host once', async () => {
    const ssh = fakeSsh({ 'github-work': 'github.com' })
    const hosts = new SshHosts(ssh.run)
    await hosts.resolve([remote('git@github-work:a/b.git')])
    await hosts.resolve([remote('git@github-work:c/d.git'), remote('git@github-work:e/f.git')])
    expect(ssh.asked).toEqual(['github-work'])
  })

  it('keeps the name when ssh cannot say, and never passes ssh a name it could read as an option', async () => {
    const ssh = fakeSsh({})
    const hosts = new SshHosts(ssh.run)
    expect(await hosts.resolve([remote('git@broken:a/b.git')])).toEqual([remote('git@broken:a/b.git')])
    expect(await hosts.resolve([remote('ssh://-oProxyCommand=x/a/b.git')])).toEqual([
      remote('ssh://-oProxyCommand=x/a/b.git')
    ])
    expect(ssh.asked).toEqual(['broken'])
  })
})
