import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { imageType, parseLfsPointer } from '../src/shared/images'

let dir: string

// Not real pictures: what matters is that the bytes come through as they are.
const v1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x01])
const v2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xfe, 0x02, 0x03])
const url = (bytes: Buffer, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`
const shown = (bytes: Buffer) => ({ url: url(bytes), bytes: bytes.length })

async function commitFile(name: string, content: Buffer | string, message: string): Promise<string> {
  writeFileSync(join(dir, name), content)
  await repo.stage(dir, [name])
  await repo.commit(dir, message, false)
  return (await git(['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()
}

beforeEach(async () => {
  dir = await repo.initRepo(join(mkdtempSync(join(tmpdir(), 'leviathan-test-')), 'repo'), 'main')
  for (const [key, value] of [
    ['user.name', 'Test User'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ]) {
    await git(['config', key, value], { cwd: dir })
  }
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('imageType', () => {
  it('knows the images a browser can draw, by extension', () => {
    expect(imageType('Assets/Screenshots/shot.PNG')).toBe('image/png')
    expect(imageType('a/photo.jpeg')).toBe('image/jpeg')
    expect(imageType('icon.ico')).toBe('image/x-icon')
    expect(imageType('Textures/rock.tga')).toBeNull()
    expect(imageType('folder.png/readme')).toBeNull()
    expect(imageType('png')).toBeNull()
  })
})

describe('parseLfsPointer', () => {
  it('reads the object a pointer stands for', () => {
    const oid = 'a'.repeat(64)
    expect(parseLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 1234\n`)).toEqual({
      oid,
      size: 1234
    })
    expect(parseLfsPointer('just text')).toBeNull()
  })
})

describe('getImages', () => {
  it('shows an uncommitted change as the staged image and the one in the folder', async () => {
    await commitFile('shot.png', v1, 'first')
    writeFileSync(join(dir, 'shot.png'), v2)

    expect(await repo.getImages(dir, { kind: 'unstaged', path: 'shot.png' })).toEqual({
      before: shown(v1),
      after: shown(v2)
    })
  })

  it('shows a staged change against the last commit', async () => {
    await commitFile('shot.png', v1, 'first')
    writeFileSync(join(dir, 'shot.png'), v2)
    await repo.stage(dir, ['shot.png'])

    expect(await repo.getImages(dir, { kind: 'staged', path: 'shot.png' })).toEqual({
      before: shown(v1),
      after: shown(v2)
    })
  })

  it('has no before for a new file, and no after for a deleted one', async () => {
    await commitFile('kept.png', v1, 'first')
    writeFileSync(join(dir, 'new.png'), v2)
    unlinkSync(join(dir, 'kept.png'))

    expect(await repo.getImages(dir, { kind: 'unstaged', path: 'new.png', untracked: true })).toEqual({
      before: null,
      after: shown(v2)
    })
    expect(await repo.getImages(dir, { kind: 'unstaged', path: 'kept.png' })).toEqual({
      before: shown(v1),
      after: null
    })
  })

  it("shows a commit's change against its parent, under its old name when renamed", async () => {
    const first = await commitFile('shot.png', v1, 'first')
    await git(['mv', 'shot.png', 'renamed.png'], { cwd: dir })
    const second = await commitFile('renamed.png', v2, 'second')

    expect(
      await repo.getImages(dir, {
        kind: 'commit',
        hash: second,
        parent: first,
        path: 'renamed.png',
        oldPath: 'shot.png'
      })
    ).toEqual({ before: shown(v1), after: shown(v2) })
    expect(await repo.getImages(dir, { kind: 'commit', hash: first, parent: null, path: 'shot.png' })).toEqual({
      before: null,
      after: shown(v1)
    })
  })

  it('shows the new image of a stash', async () => {
    await commitFile('readme.txt', 'base\n', 'first')
    writeFileSync(join(dir, 'new.png'), v2)
    await repo.stashSave(dir, null)
    const stash = (await git(['rev-parse', 'stash@{0}'], { cwd: dir })).stdout.trim()

    expect(
      await repo.getImages(dir, { kind: 'commit', hash: stash, parent: null, path: 'new.png', untracked: true })
    ).toEqual({ before: null, after: shown(v2) })
  })

  it('shows the content of a Git LFS file, from the objects downloaded here', async () => {
    const oid = 'ab'.repeat(32)
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${v2.length}\n`
    const first = await commitFile('shot.png', pointer, 'in lfs')
    const objects = join(dir, '.git', 'lfs', 'objects', 'ab', 'ab')
    mkdirSync(objects, { recursive: true })
    writeFileSync(join(objects, oid), v2)

    expect(await repo.getImages(dir, { kind: 'commit', hash: first, parent: null, path: 'shot.png' })).toEqual({
      before: null,
      after: shown(v2)
    })
    rmSync(join(objects, oid))
    expect(await repo.getImages(dir, { kind: 'commit', hash: first, parent: null, path: 'shot.png' })).toEqual({
      before: null,
      after: { url: null, bytes: v2.length, missing: 'lfs' }
    })
  })

  it('does not send an image over the size limit', async () => {
    await commitFile('shot.png', v1, 'first')
    writeFileSync(join(dir, 'shot.png'), v2)

    expect(await repo.getImages(dir, { kind: 'unstaged', path: 'shot.png' }, 11)).toEqual({
      before: shown(v1),
      after: { url: null, bytes: v2.length, missing: 'large' }
    })
  })

  it('refuses a file that is not an image', async () => {
    await expect(repo.getImages(dir, { kind: 'unstaged', path: 'notes.txt' })).rejects.toThrow()
  })
})
