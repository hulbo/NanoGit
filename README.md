<div align="center">

# NanoGit

**AI가 하는 git 작업을 지켜보는 가벼운 git 모니터**

[![빌드](https://github.com/hulbo/NanoGit/actions/workflows/build.yml/badge.svg)](https://github.com/hulbo/NanoGit/actions/workflows/build.yml)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4)
[![라이선스](https://img.shields.io/github/license/hulbo/NanoGit?label=%EB%9D%BC%EC%9D%B4%EC%84%A0%EC%8A%A4)](LICENSE)

[기획서](docs/PLANNING.md) · [개발 가이드](docs/DEVELOPMENT.md)

![NanoGit 메인 화면](docs/images/main.png)

</div>

## NanoGit은

"커밋해 줘", "push해 줘" — git 작업은 이제 AI(Claude Code 등)에게 말로 시킵니다. 사람에게 남은 일은 **AI가 무엇을 했는지 확인하는 것**입니다.
NanoGit은 그 확인을 위한 앱입니다. 화면은 소스트리(SourceTree)와 같은 구성이고, 직접 조작보다 **지켜보기**에 집중합니다.

- 저장소를 실시간으로 감시합니다. AI가 파일을 고치거나 커밋·push하면 바로 화면에 보입니다.
- 설치 파일 몇 MB, 대기 메모리 100MB 이하를 목표로 합니다 (Tauri 2 + PC의 git).
- 1차 버전은 저장소를 바꾸지 않습니다 (fetch만 합니다).

## 주요 기능

| 기능 | 설명 |
|---|---|
| **실시간 감시** | 작업 트리·커밋·브랜치·원격 변화를 1초 안에 반영. 바뀌는 저장소 탭은 점이 깜빡이고, 변경 수·push 대기 수가 붙습니다 |
| **Windows 알림** | AI가 커밋·push하거나 reset·강제 push·amend 같은 주의할 작업을 하면 앱을 보고 있지 않아도 알림으로. 한꺼번에 많이 생기면 묶어서 알리고, 종류별로 끌 수 있습니다 |
| **활동 타임라인** | AI가 한 커밋·amend·reset·전환·병합·rebase·push·fetch를 시간순으로. reset·강제 push로 **버려진 커밋**은 빨간 경고와 함께 그 자리에서 내용을 봅니다 |
| **Push 대기** | IntelliJ push 대화상자처럼 아직 push하지 않은 커밋과 바뀐 파일·diff. 원격이 앞서 있으면(pull 필요) 미리 알려 줍니다 |
| **파일 이력 (강화)** | 이름 변경까지 따라가는 이력, 두 버전 비교(Ctrl+클릭), 그 버전 내용, blame, 작업 트리와 비교, **선택한 줄만의 이력**(`git log -L`) |
| **파일 상태** | 스테이지된·안 된 파일을 **최근 변경순**으로. AI가 방금 고친 파일이 맨 위에 "방금"으로 뜹니다 |
| **히스토리** | 그래프, 브랜치·태그 배지, 모든 브랜치/현재 브랜치, 메시지 검색, push 안 한 커밋 표시 |
| **파일 우클릭 메뉴** | 어느 화면에서든 이력 조회 · Blame · 이 버전 내용 · 작업 트리와 비교 · 파일 열기 · 탐색기 · 경로 복사 |

## 빠르게 시작하기

1. **저장소 폴더 열기**로 저장소를 추가합니다 (하위 폴더를 골라도 루트를 찾습니다).
2. AI에게 평소처럼 일을 시킵니다. NanoGit의 **파일 상태**와 **활동**이 실시간으로 바뀝니다.
3. "push해 줘" 전에 **Push 대기**(`Ctrl+4`)에서 올라갈 커밋과 변경을 확인합니다.
4. 파일이 왜 이렇게 됐는지 궁금하면 `Ctrl+P`로 파일을 찾아 이력을 봅니다.

## 단축키

| 동작 | 키 |
|---|---|
| 새로고침 | `F5` |
| 파일 찾기 → 이력 조회 | `Ctrl+P` (Shift+Enter는 Blame) |
| 파일 상태 / 히스토리 / 활동 / Push 대기 / 파일 탐색 | `Ctrl+1` ~ `Ctrl+5` |
| 다음·이전 저장소 탭, 탭 닫기 | `Ctrl+Tab` / `Ctrl+Shift+Tab`, `Ctrl+W` |

## 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| M0~M2 | 기반, 모니터링(감시·활동·Push 대기·히스토리·파일 상태), 파일 이력 강화 | 첫 버전 구현 |
| M3 | 직접 조작: 스테이지·커밋·push·pull·브랜치·stash | 예정 |
| M4 | Windows 알림(완료), 트레이 상주, 여러 저장소 요약 | 진행 중 |

자세한 내용은 [기획서](docs/PLANNING.md)에 있습니다.

## 라이선스

[MIT](LICENSE)
