// 앱 안 업데이트용 latest.json 만들기 (CI가 릴리스에 올린다).
// 사용: node scripts/latest-json.mjs <태그 vX.Y.Z> <설치본 .exe> <다운로드 주소 앞부분> [릴리스 노트 .md]
// 설치본 옆의 <설치본>.sig(빌드가 서명 키로 만든 것)를 읽어 넣는다. 결과는 표준 출력으로

import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

/** tauri-plugin-updater가 읽는 형식 */
export function latestJson({ version, notes, pubDate, signature, url }) {
  const target = { signature: signature.trim(), url }
  return {
    version,
    notes: notes ?? '',
    pub_date: pubDate,
    // NSIS 설치본을 먼저 찾고, 없으면 windows-x86_64를 본다
    platforms: { 'windows-x86_64-nsis': target, 'windows-x86_64': target },
  }
}

function main([tag, exe, base, notesFile]) {
  if (!tag || !exe || !base) {
    console.error('사용: node scripts/latest-json.mjs <태그> <설치본 .exe> <다운로드 주소 앞부분> [릴리스 노트]')
    process.exit(2)
  }
  const sig = `${exe}.sig`
  if (!existsSync(sig)) {
    console.error(`서명 파일이 없습니다: ${sig} (TAURI_SIGNING_PRIVATE_KEY로 빌드했는지 확인)`)
    process.exit(1)
  }
  const json = latestJson({
    version: tag.replace(/^v/, ''),
    notes: notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim() : '',
    pubDate: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    signature: readFileSync(sig, 'utf8'),
    url: `${base.replace(/\/$/, '')}/${basename(exe)}`,
  })
  process.stdout.write(JSON.stringify(json, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
