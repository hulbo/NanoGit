import { describe, expect, it } from 'vitest'
import { FILES, problems, readVersion, writeVersion } from './version.mjs'

const byPath = (p, i = 0) => FILES.filter((f) => f.path === p)[i].re

describe('버전 맞추기', () => {
  it('package-lock.json의 두 곳만 바꾸고 의존성 버전은 그대로 둔다', () => {
    const lock = '{\n  "name": "nanogit",\n  "version": "0.1.0",\n  "packages": {\n    "": {\n      "name": "nanogit",\n      "version": "0.1.0",\n      "dependencies": {}\n    },\n    "node_modules/x": {\n      "version": "2.0.0"\n    }\n  }\n}\n'
    let t = writeVersion(lock, byPath('package-lock.json', 0), '0.2.0')
    t = writeVersion(t, byPath('package-lock.json', 1), '0.2.0')
    expect(readVersion(t, byPath('package-lock.json', 0))).toBe('0.2.0')
    expect(readVersion(t, byPath('package-lock.json', 1))).toBe('0.2.0')
    expect(t).toContain('"version": "2.0.0"')
  })

  it('Cargo.toml은 [package]의 버전만, Cargo.lock은 nanogit 항목만', () => {
    const toml = '[package]\nname = "nanogit"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nserde = { version = "1.0" }\n'
    const t = writeVersion(toml, byPath('src-tauri/Cargo.toml'), '0.2.0')
    expect(t).toContain('version = "0.2.0"\nedition')
    expect(t).toContain('serde = { version = "1.0" }')
    const lock = '[[package]]\nname = "nano"\nversion = "9.9.9"\n\n[[package]]\nname = "nanogit"\r\nversion = "0.1.0"\r\n'
    const l = writeVersion(lock, byPath('src-tauri/Cargo.lock'), '0.2.0')
    expect(l).toContain('name = "nano"\nversion = "9.9.9"')
    expect(readVersion(l, byPath('src-tauri/Cargo.lock'))).toBe('0.2.0')
  })

  it('버전이 다르거나 태그와 다르면 알린다', () => {
    expect(problems([['a', '0.1.0'], ['b', '0.1.0']], 'v0.1.0')).toEqual([])
    expect(problems([['a', '0.1.0'], ['b', '0.1.0']], null)).toEqual([])
    expect(problems([['a', '0.1.0'], ['b', '0.2.0']], null)[0]).toContain('서로 다릅니다')
    expect(problems([['a', '0.1.0']], 'v0.2.0')[0]).toContain('태그 v0.2.0')
    expect(problems([['a', null]], null)[0]).toContain('찾지 못했습니다')
  })
})
