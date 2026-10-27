import { describe, expect, it } from 'vitest'
import {
  checksumFor,
  installOffer,
  packageArgs,
  pickWindowsZip,
  sudoCommand,
  type ReleaseAsset
} from '../src/shared/lfsInstall'

const asset = (name: string): ReleaseAsset => ({ name, browser_download_url: `https://example.com/${name}` })

describe('installing git-lfs', () => {
  it("picks the zip of the machine's architecture", () => {
    const assets = [
      'git-lfs-windows-amd64-v3.8.1.zip',
      'git-lfs-windows-arm64-v3.8.1.zip',
      'git-lfs-windows-v3.8.1.exe',
      'sha256sums.asc'
    ].map(asset)
    expect(pickWindowsZip(assets, 'x64')?.name).toBe('git-lfs-windows-amd64-v3.8.1.zip')
    expect(pickWindowsZip(assets, 'arm64')?.name).toBe('git-lfs-windows-arm64-v3.8.1.zip')
    expect(pickWindowsZip(assets, 'ia32')).toBeNull()
    expect(pickWindowsZip(assets, 'ppc64')).toBeNull()
  })

  it("reads a file's checksum from the signed list", () => {
    const zip = 'ab'.repeat(32)
    const tar = 'CD'.repeat(32)
    const old = 'ef'.repeat(32)
    const sums = [
      '-----BEGIN PGP SIGNED MESSAGE-----',
      'Hash: SHA256',
      '',
      `${old}  git-lfs-windows-amd64-v3.8.1.zip.old`,
      `${zip}  git-lfs-windows-amd64-v3.8.1.zip`,
      `${tar}  git-lfs-linux-amd64-v3.8.1.tar.gz`,
      '-----BEGIN PGP SIGNATURE-----',
      'iQIzBAEBCAAdFiEE',
      '-----END PGP SIGNATURE-----'
    ].join('\n')
    expect(checksumFor(sums, 'git-lfs-windows-amd64-v3.8.1.zip')).toBe(zip)
    expect(checksumFor(sums, 'git-lfs-linux-amd64-v3.8.1.tar.gz')).toBe(tar.toLowerCase())
    expect(
      checksumFor(sums.replace(`${zip}  git-lfs-windows-amd64-v3.8.1.zip\n`, ''), 'git-lfs-windows-amd64-v3.8.1.zip')
    ).toBeNull()
    expect(checksumFor(sums, 'git-lfs-windows-arm64-v3.8.1.zip')).toBeNull()
  })

  it('offers what this system can do', () => {
    const none = { brew: null, pkexec: null, manager: null }
    expect(installOffer('win32', none)).toEqual({ method: 'zip' })
    expect(installOffer('darwin', { ...none, brew: '/opt/homebrew/bin/brew' })).toEqual({ method: 'brew' })
    expect(installOffer('darwin', none)).toEqual({ method: 'download' })
    expect(installOffer('linux', { ...none, pkexec: '/usr/bin/pkexec', manager: 'apt-get' })).toEqual({
      method: 'package'
    })
    expect(installOffer('linux', { ...none, manager: 'apt-get' })).toEqual({
      method: 'command',
      command: 'sudo apt-get install git-lfs'
    })
    expect(installOffer('linux', { ...none, pkexec: '/usr/bin/pkexec' })).toEqual({ method: 'download' })
  })

  it('installs non-interactively with each package manager', () => {
    expect(packageArgs('apt-get')).toEqual(['install', '-y', 'git-lfs'])
    expect(packageArgs('dnf')).toEqual(['install', '-y', 'git-lfs'])
    expect(packageArgs('zypper')).toEqual(['--non-interactive', 'install', 'git-lfs'])
    expect(packageArgs('pacman')).toEqual(['-S', '--noconfirm', 'git-lfs'])
    expect(sudoCommand('pacman')).toBe('sudo pacman -S git-lfs')
    expect(sudoCommand('zypper')).toBe('sudo zypper install git-lfs')
  })
})
