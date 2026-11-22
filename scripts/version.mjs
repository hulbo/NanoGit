// 앱 버전을 한 번에 맞추고 확인한다. 버전은 다섯 곳에 있다:
// package.json, package-lock.json(두 곳), src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock
//
//   node scripts/version.mjs check            다섯 곳이 같은지
//   node scripts/version.mjs check v0.2.0     그리고 태그와 같은지 (CI가 릴리스 전에 확인)
//   node scripts/version.mjs set 0.2.0        다섯 곳을 바꾼다
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/** 파일마다 버전을 읽고 바꾸는 방법. 서식(들여쓰기·줄바꿈)은 그대로 두고 그 줄만 바꾼다 */
export const FILES = [
  { path: 'package.json', re: /("version":\s*")([^"]+)(")/ },
  { path: 'package-lock.json', re: /("version":\s*")([^"]+)(")/ },
  { path: 'package-lock.json', re: /("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")([^"]+)(")/ },
  { path: 'src-tauri/tauri.conf.json', re: /("version":\s*")([^"]+)(")/ },
  { path: 'src-tauri/Cargo.toml', re: /(\[package\][^[]*?\nversion\s*=\s*")([^"]+)(")/ },
  { path: 'src-tauri/Cargo.lock', re: /(\nname = "nanogit"\r?\nversion = ")([^"]+)(")/ },
]

export function readVersion(text, re) {
  return re.exec(text)?.[2] ?? null
}

export function writeVersion(text, re, version) {
  if (!re.test(text)) return null
  return text.replace(re, (_, a, _old, b) => `${a}${version}${b}`)
}

/** 태그(`v0.2.0`)와 버전들을 맞춰 보고 문제를 돌려준다 (없으면 빈 배열) */
export function problems(versions, tag) {
  const out = []
  for (const [where, v] of versions) if (!v) out.push(`${where}: 버전을 찾지 못했습니다`)
  const found = [...new Set(versions.map(([, v]) => v).filter(Boolean))]
  if (found.length > 1) out.push(`버전이 서로 다릅니다: ${versions.map(([w, v]) => `${w}=${v}`).join(', ')}`)
  if (tag && found.length === 1 && tag !== `v${found[0]}`) out.push(`태그 ${tag}와 앱 버전 ${found[0]}이 다릅니다. node scripts/version.mjs set ${tag.replace(/^v/, '')}로 맞춘 뒤 다시 태그하세요`)
  return out
}

function readAll() {
  return FILES.map((f) => [f.path, readVersion(readFileSync(join(ROOT, f.path), 'utf8'), f.re)])
}

function main(args) {
  const [cmd, arg] = args
  if (cmd === 'check') {
    const versions = readAll()
    const bad = problems(versions, arg || null)
    if (bad.length) {
      for (const b of bad) console.error(`✗ ${b}`)
      process.exit(1)
    }
    console.log(`✓ 버전 ${versions[0][1]}${arg ? ` (태그 ${arg})` : ''}`)
  } else if (cmd === 'set') {
    if (!arg || !SEMVER.test(arg)) {
      console.error('사용: node scripts/version.mjs set 0.2.0')
      process.exit(1)
    }
    for (const f of FILES) {
      const file = join(ROOT, f.path)
      const next = writeVersion(readFileSync(file, 'utf8'), f.re, arg)
      if (next === null) {
        console.error(`✗ ${f.path}: 버전을 찾지 못했습니다`)
        process.exit(1)
      }
      writeFileSync(file, next)
    }
    console.log(`✓ 버전을 ${arg}(으)로 바꿨습니다. docs/releases/v${arg}.md에 릴리스 노트를 쓰고 커밋한 뒤 태그 v${arg}를 push하세요`)
  } else {
    console.error('사용: node scripts/version.mjs check [v0.2.0] | set 0.2.0')
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
