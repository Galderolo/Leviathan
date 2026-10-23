import type { DiffSource } from './types'

/** Editors offered in Settings; `{file}`, `{line}` and `{folder}` are filled in when opening. */
export const EDITOR_PRESETS: Preset[] = [
  { id: 'vscode', label: 'Visual Studio Code', command: 'code --goto "{file}:{line}"' },
  { id: 'cursor', label: 'Cursor', command: 'cursor --goto "{file}:{line}"' },
  { id: 'rider', label: 'JetBrains Rider', command: 'rider --line {line} "{file}"' },
  { id: 'visualstudio', label: 'Visual Studio', command: 'devenv /Edit "{file}"' },
  { id: 'sublime', label: 'Sublime Text', command: 'subl "{file}:{line}"' },
  { id: 'notepadpp', label: 'Notepad++', command: 'notepad++ -n{line} "{file}"' }
]

type Preset = { id: string; label: string; command: string }

/**
 * Terminals offered in Settings. They start in the repository's folder, and `{folder}` is filled in with its path
 * (not on Windows, where the command goes through cmd: `-d .` and `--cd=.` take the folder they start in).
 */
const TERMINAL_PRESETS: Record<'win32' | 'darwin' | 'linux', Preset[]> = {
  win32: [
    { id: 'cmd', label: 'Command Prompt', command: 'cmd' },
    { id: 'powershell', label: 'Windows PowerShell', command: 'powershell' },
    { id: 'pwsh', label: 'PowerShell 7', command: 'pwsh' },
    { id: 'wt', label: 'Windows Terminal', command: 'wt -d .' },
    { id: 'gitbash', label: 'Git Bash', command: 'git-bash --cd=.' }
  ],
  darwin: [
    { id: 'terminal', label: 'Terminal', command: 'open -a Terminal {folder}' },
    { id: 'iterm', label: 'iTerm', command: 'open -a iTerm {folder}' },
    { id: 'warp', label: 'Warp', command: 'open -a Warp {folder}' }
  ],
  linux: [
    { id: 'gnome', label: 'GNOME Terminal', command: 'gnome-terminal --working-directory={folder}' },
    { id: 'konsole', label: 'Konsole', command: 'konsole --workdir {folder}' },
    { id: 'xfce', label: 'Xfce Terminal', command: 'xfce4-terminal --working-directory={folder}' },
    { id: 'kitty', label: 'kitty', command: 'kitty --directory {folder}' },
    { id: 'alacritty', label: 'Alacritty', command: 'alacritty --working-directory {folder}' },
    { id: 'wezterm', label: 'WezTerm', command: 'wezterm start --cwd {folder}' }
  ]
}

/** The terminals Settings offers on a platform (`process.platform`); other Unixes get Linux's. */
export function terminalPresets(platform: string): Preset[] {
  return platform === 'win32' || platform === 'darwin' ? TERMINAL_PRESETS[platform] : TERMINAL_PRESETS.linux
}

/** The terminal command's arguments, `{folder}` filled in with the repository's folder. */
export function terminalArgs(template: string, folder: string): string[] {
  return splitCommand(template).map((a) => a.replaceAll('{folder}', folder))
}

/**
 * The cmd.exe arguments that start a program in a window of its own (`start`), which console programs such as
 * PowerShell need: run verbatim, as cmd reads its command line itself. Arguments with anything but plain path
 * characters are quoted, so `&`, `|`, `<`, `>` and `^` stay text; a quote cannot be passed at all.
 */
export function windowsStartLine(args: string[]): string {
  const quoted = args.map((a) => {
    if (a.includes('"')) throw new Error('A terminal command on Windows cannot pass quotes to its program')
    return /^[\w\-.:\\/=+,@~]+$/.test(a) ? a : `"${a}"`
  })
  return `/d /s /c "start "" ${quoted.join(' ')}"`
}

/** Diff and merge tools git knows by name (`git difftool --tool-help`). */
export const DIFF_TOOLS = ['vscode', 'meld', 'kdiff3', 'p4merge', 'bc', 'winmerge', 'smerge', 'araxis', 'tkdiff']

/** Splits a command line into arguments: spaces separate them, quotes ("…" or '…') keep spaces inside one. */
export function splitCommand(command: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += ch
      started = true
    }
  }
  if (started) args.push(current)
  return args
}

/**
 * The editor command with the target filled in. Without a file (opening a repository), arguments about the file
 * are dropped and the folder is opened; a command without placeholders gets the target appended.
 */
export function editorArgs(template: string, target: { file?: string; line?: number; folder: string }): string[] {
  const parts = splitCommand(template)
  if (!parts.length) return []
  const [program, ...rest] = parts
  const hasPlaceholder = rest.some((a) => /\{(file|line|folder)\}/.test(a))
  if (!hasPlaceholder) return [program, target.file ?? target.folder]
  if (!target.file) {
    // Drop the file arguments, and an option right before one, which only made sense with it (--goto, --line, /Edit).
    const kept: string[] = []
    for (const a of rest) {
      if (!/\{(file|line)\}/.test(a)) kept.push(a)
      else if (/^[-/]/.test(kept[kept.length - 1] ?? '')) kept.pop()
    }
    const args = kept.map((a) => a.replaceAll('{folder}', target.folder))
    return args.some((a) => a.includes(target.folder)) ? [program, ...args] : [program, ...args, target.folder]
  }
  // In one pass, so a file name with "{line}" in it stays as it is.
  const values: Record<string, string> = { file: target.file, line: String(target.line ?? 1), folder: target.folder }
  const fill = (a: string) => a.replace(/\{(file|line|folder)\}/g, (_, name: string) => values[name])
  return [program, ...rest.map(fill)]
}

/** The empty tree: what the first commit is compared with. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** `git difftool` arguments to show one file's change with `tool` (null: the one set in git's config). */
/**
 * Tools git does not know by name, with the command it should run for them (`$LOCAL`, `$REMOTE`, `$BASE` and
 * `$MERGED` are git's). VS Code: its diff, and its three-way merge editor.
 */
const TOOL_COMMANDS: Record<string, { diff: string; merge: string }> = {
  vscode: {
    diff: 'code --wait --diff "$LOCAL" "$REMOTE"',
    merge: 'code --wait --merge "$REMOTE" "$LOCAL" "$BASE" "$MERGED"'
  }
}

export function difftoolArgs(source: DiffSource, tool: string | null): string[] {
  const command = tool ? TOOL_COMMANDS[tool]?.diff : undefined
  const args = [
    ...(command ? ['-c', `difftool.${tool}.cmd=${command}`] : []),
    'difftool',
    '-y',
    ...(tool ? [`--tool=${tool}`] : [])
  ]
  if (source.kind === 'staged') args.push('--cached')
  if (source.kind === 'commit') args.push(source.parent ?? EMPTY_TREE, source.hash)
  // A renamed file: both paths, so the tool compares its old and new versions.
  const old = source.kind === 'commit' && source.oldPath ? [source.oldPath] : []
  return [...args, '--', ...old, source.path]
}

/** `git mergetool` arguments to resolve one conflicted file with `tool` (null: the one set in git's config). */
export function mergetoolArgs(path: string, tool: string | null): string[] {
  const command = tool ? TOOL_COMMANDS[tool]?.merge : undefined
  return [
    ...(command ? ['-c', `mergetool.${tool}.cmd=${command}`] : []),
    'mergetool',
    '-y',
    ...(tool ? [`--tool=${tool}`] : []),
    '--',
    path
  ]
}
