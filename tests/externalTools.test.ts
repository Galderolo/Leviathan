import { describe, expect, it } from 'vitest'
import { addToPathList, launchFolder } from '../src/main/cli'
import { EDITOR_PRESETS, difftoolArgs, editorArgs, mergetoolArgs, splitCommand } from '../src/shared/externalTools'

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
    expect(difftoolArgs({ kind: 'commit', hash: 'abc', parent: 'p1', path: 'x' }, 'vscode')).toEqual([
      'difftool',
      '-y',
      '--tool=vscode',
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
