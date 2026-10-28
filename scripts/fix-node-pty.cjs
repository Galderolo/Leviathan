// node-pty publishes its macOS helper (spawn-helper) without the execute bit, and without it no console starts
// ("posix_spawnp failed"). Run after npm install; packaging keeps the mode set here.
const { chmodSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const prebuilds = join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
for (const arch of ['darwin-arm64', 'darwin-x64']) {
  const helper = join(prebuilds, arch, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
