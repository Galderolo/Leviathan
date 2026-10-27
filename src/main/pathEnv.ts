/**
 * Adds `dir` at the end of the PATH of `env` (the main process's own, by default: git and the programs it starts get
 * it from there), so that nothing already on it is shadowed. False when it is already on it.
 */
export function addToPath(
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
  env[key] = [...parts, dir].join(sep)
  return true
}
