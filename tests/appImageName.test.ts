import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// electron-updater's AppImageUpdater keeps the file where it is only when its name has no version in it: otherwise an
// update leaves a file of the new name, and what pointed to the old one (launchers, the `leviathan` command's link)
// points to nothing.
describe('the AppImage file name', () => {
  it('has no version in it, so an update replaces the file in place', () => {
    const config = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
    // Its `artifactName`, past any comment lines above it.
    const name = /^appImage:\r?\n(?:[ \t]+#.*\r?\n)*[ \t]+artifactName:\s*(\S+)/m.exec(config)?.[1]
    expect(name).toBeDefined()
    const built = name!.replace('${version}', '0.24.0').replace('${ext}', 'AppImage')
    // The very test electron-updater makes (`AppImageUpdater.doInstall`).
    expect(built).not.toMatch(/\d+\.\d+\.\d+/)
  })
})
