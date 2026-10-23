import { win32 } from 'node:path'

/**
 * Windows looks for a program named without a path (git, cmd, code…) in the working folder before the PATH. The
 * app runs git, editors and terminals with a repository as working folder, so a `git.exe` committed at the root
 * of a cloned repository would run instead of git. This setting turns that off for the app, for cmd's own search
 * (start) and for every program they start, which inherit it.
 */
export function keepProgramSearchOutOfWorkingFolder(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform === 'win32') env.NoDefaultCurrentDirectoryInExePath = '1'
}

/** Windows' cmd.exe by its full path, so starting it never searches for it. */
export function commandProcessor(env: Record<string, string | undefined> = process.env): string {
  return env.ComSpec || win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
}

// Imported first by the main process, before anything is started.
keepProgramSearchOutOfWorkingFolder()
