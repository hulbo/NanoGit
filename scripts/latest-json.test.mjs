import { describe, expect, it } from 'vitest'
import { latestJson } from './latest-json.mjs'

describe('latest.json', () => {
  it('업데이트 플러그인이 읽는 모양으로 만든다', () => {
    const j = latestJson({ version: '0.1.4', notes: '## 새 기능', pubDate: '2026-11-24T08:00:00Z', signature: 'c2lnbmF0dXJl\n', url: 'https://example.com/v0.1.4/NanoGit_0.1.4_x64-setup.exe' })
    expect(j.version).toBe('0.1.4')
    expect(j.pub_date).toBe('2026-11-24T08:00:00Z')
    expect(j.platforms['windows-x86_64-nsis']).toEqual({ signature: 'c2lnbmF0dXJl', url: 'https://example.com/v0.1.4/NanoGit_0.1.4_x64-setup.exe' })
    expect(j.platforms['windows-x86_64']).toEqual(j.platforms['windows-x86_64-nsis'])
    expect(latestJson({ version: '1.0.0', pubDate: 'x', signature: 's', url: 'u' }).notes).toBe('')
  })
})
