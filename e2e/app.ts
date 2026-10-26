import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const APP_DIR = resolve(__dirname, '..')
const VERSION = (JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as { version: string }).version

/**
 * A throwaway world for one test: a folder with repositories, a git config of its own (never the machine's) and
 * an app profile of its own.
 */
export class Sandbox {
  readonly root = mkdtempSync(join(tmpdir(), 'leviathan-e2e-'))
  readonly profile = join(this.root, 'profile')
  readonly env: NodeJS.ProcessEnv

  constructor() {
    mkdirSync(this.profile)
    const gitconfig = join(this.root, 'gitconfig')
    writeFileSync(
      gitconfig,
      [
        '[user]',
        '\tname = E2E',
        '\temail = e2e@example.invalid',
        '[init]',
        '\tdefaultBranch = main',
        '[core]',
        '\tautocrlf = false',
        '[commit]',
        '\tgpgsign = false',
        ''
      ].join('\n')
    )
    this.env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: '1',
      LEVIATHAN_USER_DATA: this.profile
    }
    delete this.env.ELECTRON_RUN_AS_NODE
  }

  git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, env: this.env, encoding: 'utf8' }).trim()
  }

  /**
   * The checked-out branch, '' while it cannot be read: polled during a checkout, HEAD can be unreadable for an
   * instant ("failed to resolve HEAD").
   */
  branch(dir: string): string {
    try {
      return this.git(dir, 'branch', '--show-current')
    } catch {
      return ''
    }
  }

  /** A repository with one commit of `files`. */
  repo(name: string, files: Record<string, string>): string {
    const dir = join(this.root, name)
    mkdirSync(dir)
    this.git(dir, 'init', '-q')
    this.write(dir, files)
    this.git(dir, 'add', '.')
    this.git(dir, 'commit', '-q', '-m', 'first')
    return dir
  }

  write(dir: string, files: Record<string, string>): void {
    for (const [file, content] of Object.entries(files)) {
      const full = join(dir, file)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
  }

  read(dir: string, file: string): string {
    return readFileSync(join(dir, file), 'utf8')
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

/** Starts the built app (`npm run build` first) with `repos` open, the first one showing, and `settings` on top. */
export async function launch(
  box: Sandbox,
  repos: string[],
  settings: Record<string, unknown> = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  writeFileSync(
    join(box.profile, 'settings.json'),
    JSON.stringify({
      openTabs: repos,
      activeTab: repos[0] ?? null,
      recentRepos: repos,
      language: 'en',
      autoFetchMinutes: 0,
      autoUpdate: false,
      // Not a new version for this profile: no "What's new" on top.
      lastSeenVersion: VERSION,
      ...settings
    })
  )
  const app = await electron.launch({
    // Linux CI runners cannot use Chromium's sandbox.
    args: [APP_DIR, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: box.env as Record<string, string>,
    timeout: 60_000
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1400, height: 900 }))
  if (repos.length) await page.waitForSelector('.graph-row')
  return { app, page }
}
