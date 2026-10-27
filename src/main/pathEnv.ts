/**
 * Puts `dir` first on the PATH of `env` (the main process's own, by default: git and the programs it starts get it
 * from there). False when it is already on it.
 */
export function prependToPath(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  const windows = platform === 'win32'
  const sep = windows ? ';' : ':'
  // Windows keeps the variable as `Path`; write the name already there.
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const norm = (p: string) => {
    const trimmed = p.trim().replace(/[\\/]+$/, '')
    return windows ? trimmed.toLowerCase() : trimmed
  }
  const parts = (env[key] ?? '').split(sep).filter((p) => p.trim())
  if (parts.some((p) => norm(p) === norm(dir))) return false
  env[key] = [dir, ...parts].join(sep)
  return true
}
