import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as lfs from '../src/main/git/lfs'
import * as repo from '../src/main/git/repository'
import { git } from '../src/main/git/runner'
import { LARGE_FILE_BYTES } from '../src/shared/lfs'

interface FakeLock {
  id: string
  path: string
  locked_at: string
  owner: { name: string }
}

/** A Git LFS locking API: locks created through it belong to "me". `noLocks`: a server without one (Bitbucket Cloud). */
async function lockServer(opts: { verify: boolean; noLocks?: boolean }) {
  const locks: FakeLock[] = []
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = []
  let next = 1
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const url = new URL(req.url ?? '/', 'http://x')
      requests.push({ method: req.method ?? '', path: url.pathname, body })
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/vnd.git-lfs+json' })
        res.end(JSON.stringify(payload))
      }
      if (opts.noLocks && url.pathname.includes('/locks')) return send(404, { message: 'Not Found' })
      if (url.pathname.endsWith('/locks/verify')) {
        if (!opts.verify) return send(404, { message: 'Not found' })
        return send(200, {
          ours: locks.filter((l) => l.owner.name === 'me'),
          theirs: locks.filter((l) => l.owner.name !== 'me')
        })
      }
      const unlock = /\/locks\/([^/]+)\/unlock$/.exec(url.pathname)
      if (req.method === 'POST' && unlock) {
        const i = locks.findIndex((l) => l.id === unlock[1])
        if (i < 0) return send(404, { message: 'no such lock' })
        if (locks[i].owner.name !== 'me' && !body.force) return send(403, { message: 'lock owned by someone else' })
        return send(200, { lock: locks.splice(i, 1)[0] })
      }
      if (req.method === 'GET' && url.pathname.endsWith('/locks')) {
        const path = url.searchParams.get('path')
        const id = url.searchParams.get('id')
        return send(200, { locks: locks.filter((l) => (!path || l.path === path) && (!id || l.id === id)) })
      }
      if (req.method === 'POST' && url.pathname.endsWith('/locks')) {
        const existing = locks.find((l) => l.path === body.path)
        if (existing) return send(409, { lock: existing, message: 'already created lock' })
        const lock = { id: String(next++), path: body.path, locked_at: new Date().toISOString(), owner: { name: 'me' } }
        locks.push(lock)
        return send(201, { lock })
      }
      send(404, { message: 'not found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/repo.git/info/lfs`,
    locks,
    requests,
    seed: (path: string, owner: string) =>
      locks.push({ id: String(100 + locks.length), path, locked_at: '2026-10-22T10:00:00Z', owner: { name: owner } }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

const pointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1/

const hasLfs = await git(['lfs', 'version'], { cwd: process.cwd() }).then(
  () => true,
  () => false
)

let root: string
let work: string
const savedGlobal = process.env.GIT_CONFIG_GLOBAL

beforeAll(() => {
  // `git lfs install` writes the user's global config: point it at a scratch file.
  const dir = mkdtempSync(join(tmpdir(), 'leviathan-lfs-global-'))
  process.env.GIT_CONFIG_GLOBAL = join(dir, 'global.gitconfig')
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
})

afterAll(() => {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal
})

async function newRepo(name: string, opts: { install: boolean }) {
  const path = await repo.initRepo(join(root, name), 'main')
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 't@example.com'],
    ['commit.gpgsign', 'false'],
    ['core.autocrlf', 'false']
  ])
    await git(['config', k, v], { cwd: path })
  if (opts.install) await git(['lfs', 'install', '--local'], { cwd: path })
  writeFileSync(join(path, 'readme.txt'), 'hi\n')
  await repo.stage(path, ['readme.txt'])
  await repo.commit(path, 'base', false)
  return path
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'leviathan-lfs-'))
  if (hasLfs) work = await newRepo('work', { install: true })
})

afterEach(() => {
  // Lockable files may have been left read-only.
  rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})

describe.skipIf(!hasLfs)('LFS info and tracking', () => {
  it('says nothing about LFS in a repository that does not use it', async () => {
    const info = await lfs.getLfsInfo(work)
    expect(info).toMatchObject({ used: false, patterns: [] })
    expect(info.version).toMatch(/^\d+\.\d+/)
  })

  it('lists the tracked patterns of every attributes file, lockable or not', async () => {
    await lfs.lfsTrack(work, '*.psd', true)
    mkdirSync(join(work, 'sub'))
    writeFileSync(join(work, 'sub', '.gitattributes'), '*.wav filter=lfs diff=lfs merge=lfs -text\n')
    await repo.stage(work, ['sub/.gitattributes'])
    const info = await lfs.getLfsInfo(work)
    expect(info.used).toBe(true)
    expect(info.patterns).toEqual([
      { pattern: '*.psd', lockable: true, source: '.gitattributes' },
      { pattern: '*.wav', lockable: false, source: 'sub/.gitattributes' }
    ])
    expect(info).toMatchObject({ filters: true, hooks: true })

    await lfs.lfsUntrack(work, info.patterns[1])
    expect(readFileSync(join(work, 'sub', '.gitattributes'), 'utf8')).not.toContain('*.wav')
    expect((await lfs.getLfsInfo(work)).patterns.map((p) => p.pattern)).toEqual(['*.psd'])
  })

  it('marks the changed files that go through LFS', async () => {
    await lfs.lfsTrack(work, '*.psd', false)
    writeFileSync(join(work, 'a.psd'), 'image')
    writeFileSync(join(work, 'a.txt'), 'text')
    expect((await repo.getState(work)).lfsFiles).toEqual(['a.psd'])
  })

  it('warns about a big staged file outside LFS, and moves it into LFS', async () => {
    writeFileSync(join(work, 'big.bin'), Buffer.alloc(LARGE_FILE_BYTES + 1024))
    writeFileSync(join(work, 'small.bin'), Buffer.alloc(1024))
    await repo.stage(work, ['big.bin', 'small.bin'])
    expect((await repo.getState(work)).largeFiles).toEqual([{ path: 'big.bin', size: LARGE_FILE_BYTES + 1024 }])

    await lfs.lfsMoveFiles(work, ['big.bin'])
    const state = await repo.getState(work)
    expect(state.largeFiles).toEqual([])
    expect(state.status.staged.map((f) => f.path).sort()).toEqual(['.gitattributes', 'big.bin', 'small.bin'])
    const blob = await git(['cat-file', '-p', ':big.bin'], { cwd: work })
    expect(blob.stdout).toMatch(/^version https:\/\/git-lfs\.github\.com\/spec\/v1/)
    expect((await lfs.getLfsInfo(work)).patterns.map((p) => p.pattern)).toEqual(['*.bin'])
  })

  it('refuses patterns spanning lines and files outside the repository', async () => {
    await expect(lfs.lfsTrack(work, '*.psd\n*.exe', false)).rejects.toThrow(/pattern/)
    await expect(lfs.lfsTrack(work, '   ', false)).rejects.toThrow(/pattern/)
    await expect(lfs.lfsLock(work, '../outside.psd')).rejects.toThrow(/outside/)
    await expect(
      lfs.lfsUntrack(work, { pattern: '*.psd', lockable: false, source: '../.gitattributes' })
    ).rejects.toThrow(/outside/)
  })

  it('reads patterns that go through LFS by an attribute macro', async () => {
    writeFileSync(join(work, '.gitattributes'), '[attr]lfs filter=lfs diff=lfs merge=lfs -text\n*.psd lfs\n')
    mkdirSync(join(work, 'sub'))
    writeFileSync(join(work, 'sub', '.gitattributes'), '*.wav lfs\n')
    await repo.stage(work, ['sub/.gitattributes'])
    expect((await lfs.getLfsInfo(work)).patterns).toEqual([
      { pattern: '*.psd', lockable: false, source: '.gitattributes' },
      { pattern: '*.wav', lockable: false, source: 'sub/.gitattributes' }
    ])
  })

  it('tracking a pattern stages already-staged matching files again through LFS, with .gitattributes', async () => {
    writeFileSync(join(work, 'art.psd'), Buffer.alloc(4096, 1))
    await repo.stage(work, ['art.psd'])
    await lfs.lfsTrack(work, '*.psd', false)
    expect((await git(['cat-file', '-p', ':art.psd'], { cwd: work })).stdout).toMatch(pointer)
    const state = await repo.getState(work)
    expect(state.status.staged.map((f) => f.path).sort()).toEqual(['.gitattributes', 'art.psd'])
    expect(state.unconvertedLfs).toEqual([])
  })

  it('warns about staged files that should go through LFS, and stages them through it', async () => {
    writeFileSync(join(work, 'art.psd'), Buffer.alloc(4096, 1))
    await repo.stage(work, ['art.psd'])
    writeFileSync(join(work, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n')
    let state = await repo.getState(work)
    expect(state.unconvertedLfs).toEqual([{ path: 'art.psd', size: 4096 }])
    expect(state.largeFiles).toEqual([])

    await lfs.lfsRestage(work, ['art.psd'])
    state = await repo.getState(work)
    expect(state.unconvertedLfs).toEqual([])
    expect(state.status.staged.map((f) => f.path).sort()).toEqual(['.gitattributes', 'art.psd'])
    expect((await git(['cat-file', '-p', ':art.psd'], { cwd: work })).stdout).toMatch(pointer)
  })

  it('never replaces a staged version with a different working copy', async () => {
    writeFileSync(join(work, 'art.psd'), Buffer.alloc(4096, 1))
    await repo.stage(work, ['art.psd'])
    writeFileSync(join(work, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n')
    writeFileSync(join(work, 'art.psd'), Buffer.alloc(4096, 2))
    await expect(lfs.lfsRestage(work, ['art.psd'])).rejects.toThrow(/unstaged changes/)
    await expect(lfs.lfsMoveFiles(work, ['art.psd'])).rejects.toThrow(/unstaged changes/)
    await lfs.lfsTrack(work, '*.psd', false)
    const staged = (await git(['cat-file', '-p', ':art.psd'], { cwd: work })).stdout
    expect(staged).toBe('\x01'.repeat(4096))
    expect((await repo.getState(work)).unconvertedLfs).toEqual([{ path: 'art.psd', size: 4096 }])
  })

  it('sets up LFS where it is missing: filters, hooks', async () => {
    const plain = await newRepo('plain', { install: false })
    writeFileSync(join(plain, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n')
    const before = await lfs.getLfsInfo(plain)
    expect(before).toMatchObject({ used: true, hooks: false })

    expect(await lfs.setupLfs(plain, () => {})).toEqual({ hooksToMerge: null })
    expect(await lfs.getLfsInfo(plain)).toMatchObject({ used: true, filters: true, hooks: true })
    expect(readFileSync(process.env.GIT_CONFIG_GLOBAL!, 'utf8')).toContain('[filter "lfs"]')
  })

  // git-lfs never writes over a hook of another tool (husky…): it stops at the first one, setting none up.
  it('sets up LFS beside a hook of another tool: keeps it, adds the missing ones, and says what to add to it', async () => {
    const shared = await newRepo('shared-hooks', { install: false })
    writeFileSync(join(shared, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n')
    const hooks = join(shared, '.git', 'hooks')
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\necho checks\n')

    const { hooksToMerge } = await lfs.setupLfs(shared, () => {})
    expect(readFileSync(join(hooks, 'pre-push'), 'utf8')).toBe('#!/bin/sh\necho checks\n')
    expect(hooksToMerge).toContain('git lfs pre-push "$@"')
    expect(hooksToMerge).not.toContain('post-checkout')
    for (const name of ['post-checkout', 'post-commit', 'post-merge']) {
      expect(readFileSync(join(hooks, name), 'utf8')).toContain(`git lfs ${name} "$@"`)
    }
    expect(await lfs.getLfsInfo(shared)).toMatchObject({ filters: true, hooks: false })

    // Once the lines are in it, nothing is left to add.
    writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\necho checks\ngit lfs pre-push "$@"\n')
    expect(await lfs.setupLfs(shared, () => {})).toEqual({ hooksToMerge: null })
    expect(await lfs.getLfsInfo(shared)).toMatchObject({ hooks: true })
  })
})

describe.skipIf(!hasLfs)('LFS locks', () => {
  let server: Awaited<ReturnType<typeof lockServer>>

  beforeEach(async () => {
    server = await lockServer({ verify: true })
    await git(['config', 'lfs.url', server.url], { cwd: work })
    await lfs.lfsTrack(work, '*.psd', false)
    writeFileSync(join(work, 'a.psd'), 'a')
    writeFileSync(join(work, 'b.psd'), 'b')
    await repo.stage(work, ['.gitattributes', 'a.psd', 'b.psd'])
    await repo.commit(work, 'art', false)
  })

  afterEach(() => server.close())

  it('locks a file and tells my locks from the others', async () => {
    expect(await lfs.getLfsLocks(work)).toEqual({ locks: [], verified: true })
    const lock = await lfs.lfsLock(work, 'a.psd')
    expect(lock).toMatchObject({ path: 'a.psd', owner: 'me', mine: true })
    server.seed('b.psd', 'ana')
    const { locks, verified } = await lfs.getLfsLocks(work, true)
    expect(verified).toBe(true)
    expect(locks.map((l) => [l.path, l.owner, l.mine])).toEqual([
      ['a.psd', 'me', true],
      ['b.psd', 'ana', false]
    ])
    await expect(lfs.lfsLock(work, 'b.psd')).rejects.toThrow(/already created lock/)
  })

  it('unlocks my lock, but not while the file has uncommitted changes', async () => {
    const lock = await lfs.lfsLock(work, 'a.psd')
    chmodSync(join(work, 'a.psd'), 0o644)
    writeFileSync(join(work, 'a.psd'), 'changed')
    await expect(lfs.lfsUnlock(work, lock, false)).rejects.toThrow(/uncommitted/)
    expect(server.locks).toHaveLength(1)
    await repo.discard(work, ['a.psd'], [])
    await lfs.lfsUnlock(work, lock, false)
    expect(server.locks).toEqual([])
  })

  it("forces someone else's lock open only when asked to", async () => {
    server.seed('b.psd', 'ana')
    const [lock] = (await lfs.getLfsLocks(work)).locks
    await expect(lfs.lfsUnlock(work, lock, false)).rejects.toThrow()
    expect(server.locks).toHaveLength(1)
    await lfs.lfsUnlock(work, lock, true)
    expect(server.locks).toEqual([])
    expect(server.requests.some((r) => r.path.endsWith(`/locks/${lock.id}/unlock`) && r.body.force === true)).toBe(true)
  })

  it('unlocks a file that no longer exists here', async () => {
    // For lockable files git-lfs fails resetting the missing file's permissions after the server let go.
    await lfs.lfsTrack(work, '*.psd', true)
    const lock = await lfs.lfsLock(work, 'gone.psd')
    expect(existsSync(join(work, 'gone.psd'))).toBe(false)
    await lfs.lfsUnlock(work, lock, false)
    expect(server.locks).toEqual([])
  })

  it('lists locks without owners when the server cannot verify them', async () => {
    const old = server
    server = await lockServer({ verify: false })
    await old.close()
    await git(['config', 'lfs.url', server.url], { cwd: work })
    server.seed('b.psd', 'ana')
    expect(await lfs.getLfsLocks(work)).toMatchObject({
      verified: false,
      locks: [{ path: 'b.psd', owner: 'ana', mine: null }]
    })
    server.locks.length = 0
    expect(await lfs.getLfsLocks(work)).toEqual({ locks: [], verified: false })
  })

  it('says when the server has no locking API at all, like Bitbucket Cloud, instead of failing', async () => {
    const old = server
    server = await lockServer({ verify: false, noLocks: true })
    await old.close()
    await git(['config', 'lfs.url', server.url], { cwd: work })
    expect(await lfs.getLfsLocks(work, true)).toEqual({ locks: [], verified: false, unsupported: true })
  })

  it('reports an unreachable server instead of an empty list', async () => {
    await git(['config', 'lfs.url', 'http://127.0.0.1:1/repo.git/info/lfs'], { cwd: work })
    await expect(lfs.getLfsLocks(work, true)).rejects.toThrow(/locks/i)
  })
})
