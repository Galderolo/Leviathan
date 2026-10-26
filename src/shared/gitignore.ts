/** `text` with what .gitignore reads as a pattern (`\ * ? [`) or drops (trailing spaces) escaped. */
function literal(text: string): string {
  return text.replace(/[\\*?[]/g, (c) => `\\${c}`).replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))
}

/** The .gitignore line for one file, its path taken literally, from the top of the repository. */
export function ignoreFile(path: string): string {
  return `/${literal(path)}`
}

/** The .gitignore line for every file with this extension. */
export function ignoreExtension(ext: string): string {
  return `*.${literal(ext)}`
}
