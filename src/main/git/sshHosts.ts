import { execFile } from 'node:child_process'
import type { Remote } from '../../shared/types'

/** The configuration ssh would use for `host` (`ssh -G`): read locally, nothing is connected to. */
function sshConfig(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ssh', ['-G', host], { windowsHide: true, timeout: 5000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  })
}

/** A host name ssh cannot take for an option. */
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
// git@host:path (not a Windows path: the host has two characters or more), and ssh://user@host:port/path.
const SCP = /^((?:[^@/\s]+@)?)([^:/\s]{2,})(:(?!\/).+)$/
const SSH = /^(ssh:\/\/(?:[^@/]+@)?)([^/:]+)(.*)$/i

/**
 * The real hosts behind SSH aliases (`Host` entries in ~/.ssh/config, the usual way to use two accounts on one
 * server): remotes like `git@github-work:org/app` reach github.com, and only then can an account be found for them.
 */
export class SshHosts {
  private readonly known = new Map<string, Promise<string>>()

  constructor(private readonly run: (host: string) => Promise<string> = sshConfig) {}

  /** The host ssh connects to for `name`; `name` itself when ssh cannot say. */
  hostName(name: string): Promise<string> {
    let found = this.known.get(name)
    if (!found) {
      found = this.run(name).then(
        (out) => /^hostname (\S+)$/im.exec(out)?.[1].toLowerCase() ?? name,
        () => name
      )
      this.known.set(name, found)
    }
    return found
  }

  /** `remotes` with the real host in their SSH URLs. */
  resolve(remotes: Remote[]): Promise<Remote[]> {
    return Promise.all(
      remotes.map(async (r) => ({ ...r, fetchUrl: await this.url(r.fetchUrl), pushUrl: await this.url(r.pushUrl) }))
    )
  }

  private async url(url: string): Promise<string> {
    const match = (!url.includes('://') && SCP.exec(url)) || SSH.exec(url)
    if (!match || !HOST.test(match[2])) return url
    return match[1] + (await this.hostName(match[2])) + match[3]
  }
}
