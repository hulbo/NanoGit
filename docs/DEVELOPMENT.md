# 개발 가이드

NanoGit을 직접 빌드하거나 고치려는 사람을 위한 문서입니다. 만든 배경과 설계는 [기획서](PLANNING.md)를 보세요.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 앱 셸 | [Tauri 2](https://tauri.app/) (Windows WebView2) |
| 백엔드 | Rust: git 실행·출력 해석, reflog 읽기, 파일 감시(`notify`), 설정 저장 |
| 화면 | Svelte 5 + TypeScript, Vite |
| git | PC에 설치된 git 명령 (libgit2를 넣지 않음) |
| 테스트 | `cargo test`(실제 git으로 저장소를 만들어 확인), vitest, svelte-check |
| 빌드·배포 | GitHub Actions → NSIS 설치본 |

## 준비

- Node.js 20 이상
- Rust stable (`rustup`, MSVC 툴체인)
- Visual Studio C++ Build Tools, WebView2 (Windows 11 기본 포함)
- Git for Windows (테스트와 실행에 필요)

## 빌드와 실행

```powershell
npm install
npm run tauri dev     # 앱 개발 실행
npm run tauri build   # 설치본 빌드 → src-tauri/target/release/bundle/nsis/
```

## 검사와 테스트

```powershell
npm run check                                   # Svelte·TypeScript 타입 검사
npm test                                        # 화면 단위 테스트 (그래프, diff, 활동 분류, 알림, 트레이·저장소 요약, 시간 표시, 파일 찾기)
cargo test --manifest-path src-tauri/Cargo.toml # 백엔드 테스트 (파서 + 실제 git 저장소로 조회·reflog·감시)
```

## 브라우저 미리보기

`npm run dev`로 띄운 화면(`http://localhost:1421`)을 일반 브라우저에서 열면 **가짜 백엔드**(`src/lib/mock.ts`)로 동작합니다. 샘플 저장소 두 개(병합·이름 변경·reset·amend·push가 들어 있는 이력)가 열려 있어 화면만 고칠 때 편합니다. `?tab=overview`를 붙이면 저장소 요약 화면부터 엽니다. 문서의 스크린샷도 이 화면으로 찍었습니다.

## 설정 폴더 분리

환경변수 `NANOGIT_HOME`에 폴더를 지정하면 설정(`settings.json`)을 그 폴더에 둡니다. 이때는 단일 인스턴스 검사를 건너뛰므로, 평소 쓰는 설치본을 켜 둔 채 개발 빌드를 따로 띄울 수 있습니다.

## 코드 구조

```
src/                         화면 (Svelte 5 + TypeScript)
  App.svelte                 전체 배치, 단축키
  lib/api.ts                 백엔드 호출 (Tauri / 브라우저용 가짜 백엔드)
  lib/mock.ts                브라우저 미리보기용 가짜 저장소
  lib/state.svelte.ts        앱 상태: 저장소 탭(Repo)과 화면 상태, 변화 감지 → 새로고침·알림
  lib/types.ts               백엔드와 같은 모양의 데이터
  lib/graph.ts               히스토리 그래프 레인 계산
  lib/diff.ts                unified diff 해석, 통합·나란히 보기, 바뀐 부분 강조
  lib/activity.ts            reflog 항목 → 활동 종류·설명·위험도
  lib/notify.ts              새 활동 → Windows 알림 (종류별 켜기·끄기, 많으면 묶기)
  lib/tray.ts                트레이 툴팁·메뉴에 보일 저장소 요약
  lib/overview.ts            저장소 요약 화면: 마지막 변화, 최근 바뀐 파일, 경고 수, 전체 활동 합치기
  lib/fuzzy.ts               파일 찾기 퍼지 검색
  lib/format.ts              시간·경로 표시
  lib/menus.ts               파일·커밋 우클릭 메뉴
  lib/components/            RepoTabs, Toolbar, Sidebar, HistoryView, StatusView, ActivityView,
                             OutgoingView, FileHistoryView, FilesView, DiffView, CodeView, ...
src-tauri/src/               백엔드 (Rust, Tauri 2)
  lib.rs                     앱 시작, 명령 등록
  commands.rs                IPC 명령 (모두 별도 스레드에서 git 실행)
  git/mod.rs                 git 찾기·실행(창 없이, 제한 시간, GIT_OPTIONAL_LOCKS=0), 저장소 찾기, 인코딩
  git/parse.rs               log·status·raw/numstat·blame·reflog 출력 해석
  git/query.rs               조회: 상태, 참조, 히스토리, 커밋, diff, push 대기, 파일 이력, blame, 줄 이력
  git/reflog.rs              활동 타임라인 (reflog 파일 직접 읽기, 버려진 커밋 수)
  git/model.rs               화면으로 보내는 데이터
  watch.rs                   저장소 파일 감시와 변화 묶기
  store.rs                   설정 파일
  tray.rs                    트레이 아이콘·메뉴, 창 닫기 → 트레이, Windows 시작 시 실행(HKCU Run, --tray)
  shell.rs                   터미널·편집기 열기
docs/                        기획서, 개발 가이드, 스크린샷
```

## 원칙

- **1차는 읽기 전용**: fetch를 빼면 저장소를 바꾸는 git 명령을 실행하지 않습니다. 조회는 `GIT_OPTIONAL_LOCKS=0`으로 실행해 AI가 실행 중인 git 명령과 `index.lock`으로 부딪히지 않게 합니다.
- 사용자가 준 리비전은 `-`로 시작하면 거부하고(`check_rev`), 경로는 항상 `--` 뒤에 넘깁니다.
- 테스트·샘플·문서에는 지어낸 이름만 씁니다.

## CI

`main`에 push하면 GitHub Actions가 타입 검사·테스트를 돌리고 설치본을 빌드합니다. 결과물은 실행 기록의 `nanogit-windows` 아티팩트로 받을 수 있습니다.
