import { describe, expect, it } from 'vitest'
import {
  addToPathList,
  commandShim,
  launchFolder,
  offerLaunchFolder,
  takeLaunchFolders,
  windowLoading
} from '../src/main/cli'
import {
  EDITOR_PRESETS,
  difftoolArgs,
  editorArgs,
  mergetoolArgs,
  splitCommand,
  terminalArgs,
  terminalPresets,
  windowsStartLine
} from '../src/shared/externalTools'

describe('splitCommand', () => {
  it('splits a command line like a shell would, keeping quoted parts and Windows paths whole', () => {
    expect(splitCommand('code --goto "{file}:{line}"')).toEqual(['code', '--goto', '{file}:{line}'])
    expect(splitCommand('"C:\\Program Files\\Sublime Text\\subl.exe" -w {file}')).toEqual([
      'C:\\Program Files\\Sublime Text\\subl.exe',
      '-w',
      '{file}'
    ])
    expect(splitCommand("  rider  --line {line}  '{file}' ")).toEqual(['rider', '--line', '{line}', '{file}'])
    expect(splitCommand('')).toEqual([])
  })
})

describe('editorArgs', () => {
  it('fills in the file, its line and the folder, each argument whole even with spaces', () => {
    const vscode = EDITOR_PRESETS.find((p) => p.id === 'vscode')!.command
    expect(editorArgs(vscode, { file: 'D:\\My Game\\Assets\\Player.cs', line: 42, folder: 'D:\\My Game' })).toEqual([
      'code',
      '--goto',
      'D:\\My Game\\Assets\\Player.cs:42'
    ])
    expect(editorArgs('notepad++ -n{line} "{file}"', { file: 'a b.txt', folder: '.' })).toEqual([
      'notepad++',
      '-n1',
      'a b.txt'
    ])
  })

  it('opens the folder when there is no file, and adds the target to a bare command', () => {
    expect(editorArgs('code --goto "{file}:{line}"', { folder: 'D:\\Repo' })).toEqual(['code', 'D:\\Repo'])
    expect(editorArgs('subl', { file: 'x.txt', folder: '.' })).toEqual(['subl', 'x.txt'])
    expect(editorArgs('code -n "{folder}"', { file: 'x.txt', folder: 'D:\\Repo' })).toEqual(['code', '-n', 'D:\\Repo'])
    expect(editorArgs('   ', { file: 'x.txt', folder: '.' })).toEqual([])
  })

  it('leaves placeholder-like text inside a file name alone', () => {
    expect(editorArgs('ed "{file}:{line}"', { file: 'D:\\x{line}{folder}.txt', line: 5, folder: 'D:\\' })).toEqual([
      'ed',
      'D:\\x{line}{folder}.txt:5'
    ])
  })
})

describe('difftoolArgs / mergetoolArgs', () => {
  it('asks git to show one file with the chosen tool, never prompting', () => {
    expect(difftoolArgs({ kind: 'unstaged', path: 'a b.txt' }, 'meld')).toEqual([
      'difftool',
      '-y',
      '--tool=meld',
      '--',
      'a b.txt'
    ])
    expect(difftoolArgs({ kind: 'staged', path: 'x' }, null)).toEqual(['difftool', '-y', '--cached', '--', 'x'])
    expect(difftoolArgs({ kind: 'commit', hash: 'abc', parent: 'p1', path: 'x' }, 'meld')).toEqual([
      'difftool',
      '-y',
      '--tool=meld',
      'p1',
      'abc',
      '--',
      'x'
    ])
    // The first commit compares with the empty tree.
    expect(difftoolArgs({ kind: 'commit', hash: 'abc', parent: null, path: 'x' }, null)).toEqual([
      'difftool',
      '-y',
      '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'abc',
      '--',
      'x'
    ])
    expect(mergetoolArgs('a.txt', 'kdiff3')).toEqual(['mergetool', '-y', '--tool=kdiff3', '--', 'a.txt'])
  })

  it('tells git how to run VS Code, which git does not know as a tool', () => {
    expect(difftoolArgs({ kind: 'unstaged', path: 'a.txt' }, 'vscode')).toEqual([
      '-c',
      'difftool.vscode.cmd=code --wait --diff "$LOCAL" "$REMOTE"',
      'difftool',
      '-y',
      '--tool=vscode',
      '--',
      'a.txt'
    ])
    expect(mergetoolArgs('a.txt', 'vscode')).toEqual([
      '-c',
      'mergetool.vscode.cmd=code --wait --merge "$REMOTE" "$LOCAL" "$BASE" "$MERGED"',
      'mergetool',
      '-y',
      '--tool=vscode',
      '--',
      'a.txt'
    ])
  })

  it('names both paths of a file the commit renamed, so the tool compares the old and new versions', () => {
    expect(
      difftoolArgs({ kind: 'commit', hash: 'abc', parent: 'p1', path: 'new.txt', oldPath: 'old.txt' }, null)
    ).toEqual(['difftool', '-y', 'p1', 'abc', '--', 'old.txt', 'new.txt'])
  })
})

describe('launchFolder', () => {
  it('takes the folder given on the command line, relative to where it was typed', () => {
    expect(launchFolder(['C:\\Apps\\Leviathan.exe', '.'], 'D:\\Game', false)).toBe('D:\\Game')
    expect(launchFolder(['/opt/Leviathan/leviathan', '../other', '--no-sandbox'], '/home/ana/game', false)).toBe(
      '/home/ana/other'
    )
    expect(launchFolder(['C:\\Apps\\Leviathan.exe'], 'D:\\Game', false)).toBeNull()
    expect(launchFolder(['C:\\Apps\\Leviathan.exe', '--squirrel-firstrun'], 'D:\\Game', false)).toBeNull()
  })

  it('skips the app folder when run by electron itself (development)', () => {
    expect(launchFolder(['electron.exe', 'D:\\GIT_MANAGER'], 'D:\\GIT_MANAGER', true)).toBeNull()
    expect(launchFolder(['electron.exe', '.', 'D:\\Game'], 'D:\\GIT_MANAGER', true)).toBe('D:\\Game')
    // Switches can come before the app folder.
    expect(
      launchFolder(['electron.exe', '--inspect=0', '--remote-debugging-port=0', 'D:\\GIT_MANAGER'], 'D:\\', true)
    ).toBeNull()
    expect(launchFolder(['electron.exe', '--inspect=0', 'D:\\GIT_MANAGER', 'game'], 'D:\\', true)).toBe('D:\\game')
  })

  it('resolves against the folder the leviathan command passes (the portable build runs from a temporary folder)', () => {
    const exe = 'C:\\Temp\\2x\\Leviathan.exe'
    expect(launchFolder([exe, '--cwd=D:\\Game\\.', '.'], 'C:\\Temp\\2x', false)).toBe('D:\\Game')
    expect(launchFolder([exe, '--cwd=C:\\\\.', 'sub'], 'C:\\Temp\\2x', false)).toBe('C:\\sub')
    expect(launchFolder([exe, '--cwd=D:\\Game\\.', 'E:\\Other'], 'C:\\Temp\\2x', false)).toBe('E:\\Other')
    expect(launchFolder([exe, '--cwd=D:\\Game\\.'], 'C:\\Temp\\2x', false)).toBeNull()
  })
})

describe('commandShim', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\José\\AppData\\Local',
    APPDATA: 'C:\\Users\\José\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\José'
  }

  it('starts the app with the folder it was typed in, naming user folders by their variables (cmd reads the file in the console code page)', () => {
    expect(commandShim('c:\\users\\josé\\AppData\\Local\\Programs\\leviathan\\Leviathan.exe', env)).toBe(
      '@echo off\r\nstart "" "%LOCALAPPDATA%\\Programs\\leviathan\\Leviathan.exe" --cwd="%CD%\\." %*\r\n'
    )
    expect(commandShim('C:\\Users\\José\\Desktop\\Leviathan 0.10.0.exe', env)).toContain(
      '"%USERPROFILE%\\Desktop\\Leviathan 0.10.0.exe"'
    )
  })

  it('keeps a % in the path and refuses one cmd cannot read', () => {
    expect(commandShim('D:\\100%\\Leviathan.exe', {})).toContain('"D:\\100%%\\Leviathan.exe"')
    expect(() => commandShim('D:\\Programación\\Leviathan.exe', env)).toThrow(/D:\\Programación/)
  })
})

describe('folders from the command line', () => {
  it('wait until the window has restored its tabs, in order, and go straight to it afterwards', () => {
    windowLoading()
    takeLaunchFolders()
    windowLoading()
    expect(offerLaunchFolder('D:\\A')).toBe('queued')
    expect(offerLaunchFolder('D:\\B')).toBe('queued')
    expect(takeLaunchFolders()).toEqual(['D:\\A', 'D:\\B'])
    expect(offerLaunchFolder('D:\\C')).toBe('send')
    expect(takeLaunchFolders()).toEqual([])
    // A reload: the window has to ask again.
    windowLoading()
    expect(offerLaunchFolder('D:\\D')).toBe('queued')
    expect(takeLaunchFolders()).toEqual(['D:\\D'])
  })
})

describe('addToPathList', () => {
  it('appends a folder to the user PATH once', () => {
    expect(addToPathList('C:\\Windows;C:\\Tools', 'C:\\Users\\ana\\AppData\\Local\\Leviathan\\bin')).toBe(
      'C:\\Windows;C:\\Tools;C:\\Users\\ana\\AppData\\Local\\Leviathan\\bin'
    )
    expect(
      addToPathList(
        'C:\\Tools;c:\\users\\ana\\appdata\\local\\leviathan\\bin\\',
        'C:\\Users\\ana\\AppData\\Local\\Leviathan\\bin'
      )
    ).toBeNull()
    expect(addToPathList('', 'C:\\bin')).toBe('C:\\bin')
    expect(addToPathList('C:\\Tools;', 'C:\\bin')).toBe('C:\\Tools;C:\\bin')
  })
})

describe('terminal commands', () => {
  it('fills in the folder as one argument, whatever it holds', () => {
    expect(terminalArgs('konsole --workdir {folder}', '/home/ana/My Game')).toEqual([
      'konsole',
      '--workdir',
      '/home/ana/My Game'
    ])
    expect(terminalArgs('xfce4-terminal --working-directory={folder}', '/g')).toEqual([
      'xfce4-terminal',
      '--working-directory=/g'
    ])
    expect(terminalArgs('wt -d .', 'C:\\g')).toEqual(['wt', '-d', '.'])
    expect(terminalArgs('   ', 'C:\\g')).toEqual([])
  })

  it('starts a Windows terminal through start, quoting what cmd would read', () => {
    expect(windowsStartLine(['cmd'])).toBe('/d /s /c "start "" cmd"')
    expect(windowsStartLine(['C:\\Program Files\\Git\\git-bash.exe', '--cd=.'])).toBe(
      '/d /s /c "start "" "C:\\Program Files\\Git\\git-bash.exe" --cd=."'
    )
    // & | < > ^ would end or redirect the command outside quotes.
    expect(windowsStartLine(['wt', '-d', 'D:\\R&D\\game'])).toBe('/d /s /c "start "" wt -d "D:\\R&D\\game""')
    expect(windowsStartLine(['pwsh', ''])).toBe('/d /s /c "start "" pwsh """')
    // cmd has no way to pass a quote inside a quoted argument.
    expect(() => windowsStartLine(['pwsh', '-c', 'echo "hi"'])).toThrow(/quote/i)
  })

  it("offers each system's terminals; on Windows none takes the folder on its command line", () => {
    expect(terminalPresets('win32').map((p) => p.id)).toEqual(['cmd', 'powershell', 'pwsh', 'wt', 'gitbash'])
    expect(terminalPresets('darwin').map((p) => p.id)).toEqual(['terminal', 'iterm', 'warp'])
    expect(terminalPresets('linux')[0].id).toBe('gnome')
    expect(terminalPresets('freebsd')).toEqual(terminalPresets('linux'))
    // There it would go through cmd, which expands %…% even inside quotes: they start in it instead.
    for (const p of terminalPresets('win32')) expect(p.command).not.toContain('{folder}')
    for (const p of [...terminalPresets('darwin'), ...terminalPresets('linux')]) expect(p.command).toContain('{folder}')
  })
})
