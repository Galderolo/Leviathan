/** A console's tab label: its shell's program, without folder or extension (`powershell`, `bash`, `zsh`). */
export function shellLabel(file: string): string {
  return (
    file
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/i, '') || 'shell'
  )
}

/** A link in the terminal opens with Ctrl+click (⌘+click on macOS), as in VS Code: a plain click selects text. */
export function opensLink(e: { ctrlKey: boolean; metaKey: boolean }, mac: boolean): boolean {
  return mac ? e.metaKey : e.ctrlKey
}

export const TERMINAL_FONT_DEFAULT = 13

/** The terminal's font size from Settings, within what reads well. */
export function terminalFontSize(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_FONT_DEFAULT
  return Math.min(24, Math.max(9, Math.round(value)))
}
