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

`npm run dev`로 띄운 화면(`http://localhost:1421`)을 일반 브라우저에서 열면 **가짜 백엔드**(`src/lib/mock.ts`)로 동작합니다. 샘플 저장소 두 개(병합·이름 변경·reset·amend·push가 들어 있는 이력)가 열려 있어 화면만 고칠 때 편합니다. `?tab=overview`를 붙이면 저장소 요약 화면부터, `?view=status`를 붙이면 파일 상태부터 엽니다. 미리보기에서도 스테이지·커밋·push는 화면에 반영되고(가짜), 나머지 조작은 흉내만 냅니다. 문서의 스크린샷도 이 화면으로 찍었습니다.

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
  lib/highlight.ts           구문 강조: 파일 종류 고르기, highlight.js 결과 → 줄마다 색 조각, 매퍼 XML의 SQL
  lib/activity.ts            reflog 항목 → 활동 종류·설명·위험도
  lib/notify.ts              새 활동 → Windows 알림 (종류별 켜기·끄기, 많으면 묶기)
  lib/tray.ts                트레이 툴팁·메뉴에 보일 저장소 요약
  lib/overview.ts            저장소 요약 화면: 마지막 변화, 최근 바뀐 파일, 경고 수, 전체 활동 합치기
  lib/fuzzy.ts               파일 찾기: 퍼지 검색, *·? 와일드카드(like) 검색
  lib/format.ts              시간·경로 표시
  lib/menus.ts               파일·커밋·브랜치·태그·stash 우클릭 메뉴
  lib/actions.ts             직접 조작 흐름 (확인·입력 대화상자 → 조작 → 알림)
  lib/dialog.ts              조작 대화상자(OpDialog)의 입력 칸 모양
  lib/components/            RepoTabs, Toolbar, Sidebar, HistoryView, StatusView, ActivityView,
                             OutgoingView, FileHistoryView, FilesView, DiffView, CodeView, CodeText, OpDialog, ...
src-tauri/src/               백엔드 (Rust, Tauri 2)
  lib.rs                     앱 시작, 명령 등록
  commands.rs                IPC 명령 (모두 별도 스레드에서 git 실행)
  git/mod.rs                 git 찾기·실행(창 없이, 제한 시간, GIT_OPTIONAL_LOCKS=0), 저장소 찾기, 인코딩
  git/parse.rs               log·status·raw/numstat·blame·reflog 출력 해석
  git/query.rs               조회: 상태, 참조, 히스토리(메시지·작성자 검색, 커밋 ID 찾기, 작성자 목록), 커밋, diff,
                             push 대기, 파일 이력, blame, 줄 이력
  git/ops.rs                 직접 조작: 스테이지·헝크·버리기(휴지통), 커밋, push·pull, 브랜치·병합·stash·태그
  git/reflog.rs              활동 타임라인 (reflog 파일 직접 읽기, 버려진 커밋 수)
  git/model.rs               화면으로 보내는 데이터
  watch.rs                   저장소 파일 감시와 변화 묶기
  store.rs                   설정 파일
  tray.rs                    트레이 아이콘·메뉴, 창 닫기 → 트레이, Windows 시작 시 실행(HKCU Run, --tray)
  shell.rs                   터미널·편집기 열기
docs/                        기획서, 개발 가이드, 스크린샷, 릴리스 노트(releases/)
scripts/version.mjs          앱 버전 맞추기·확인 (릴리스용)
scripts/latest-json.mjs      앱 안 업데이트가 읽는 latest.json 만들기 (CI가 릴리스에 올림)
```

## 원칙

- **감시가 먼저**: 조회(`query.rs`, `reflog.rs`)는 저장소를 바꾸지 않고 `GIT_OPTIONAL_LOCKS=0`으로 실행해 AI가 실행 중인 git 명령과 `index.lock`으로 부딪히지 않게 합니다.
- **조작은 `git/ops.rs`에만**: IPC 명령은 `git_op` 하나이고, 화면에서 사용자가 고르고 확인한 것만 보냅니다. 감시 전용 모드(`readOnly`)면 백엔드가 거부하고, 한 저장소에서는 조작을 한 번에 하나만 실행합니다.
  - 편집기를 띄우지 않습니다(`GIT_EDITOR=true`). 창 없는 git이 편집기를 기다리며 멈추지 않게 합니다.
  - 경로는 `:(literal)`을 붙여 표준 입력으로 넘깁니다(`--pathspec-from-file`). `GIT_LITERAL_PATHSPECS`는 `stash -u`가 새 파일을 치우지 못하게 해서 쓰지 않습니다.
  - 작업 트리 파일을 버리거나 덮어쓰기 전에 지금 파일을 **휴지통**에 남깁니다 (테스트에서는 그냥 지움).
  - 강제 push는 `--force-with-lease`만 씁니다. reset처럼 이력을 지우는 조작은 아직 넣지 않았습니다.
- 사용자가 준 리비전은 `-`로 시작하면 거부하고(`check_rev`), 경로는 항상 `--` 뒤에 넘깁니다.
- 테스트·샘플·문서에는 지어낸 이름만 씁니다.

## CI

`main`에 push하면 GitHub Actions가 버전 확인·타입 검사·테스트를 돌리고 설치본을 빌드합니다. 결과물은 실행 기록의 `nanogit-windows` 아티팩트로 받을 수 있습니다.

## 릴리스

태그(`v*`)를 push하면 CI가 같은 빌드를 한 뒤 GitHub 릴리스를 만들고 설치본을 올립니다.
설치본에는 업데이트 서명(`.sig`)을 붙이고 `latest.json`도 함께 올려, 설치된 NanoGit이 앱 안에서 새 버전을 받습니다.

1. 버전 바꾸기: `npm run version:set -- 0.2.0`
   - package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock의 버전 줄만 바꿉니다.
   - 다섯 곳이 같은지는 `npm run version:check`로 봅니다.
2. 릴리스 노트: `docs/releases/v0.2.0.md`를 씁니다. 없으면 GitHub가 커밋 목록으로 만듭니다.
3. 커밋하고 `main`에 push합니다.
4. 태그 push:
   ```
   git tag -a v0.2.0 -m "NanoGit 0.2.0"
   git push origin v0.2.0
   ```

참고:
- 태그와 앱 버전이 다르면 CI가 빌드 전에 멈춥니다.
- `-`가 들어간 태그(`v0.3.0-beta.1`)는 사전 릴리스로 올라갑니다.
- 같은 태그의 실행을 다시 돌리면 설치본·서명·latest.json만 바꿔 올립니다.

### 앱 안 업데이트 (tauri-plugin-updater)

- 앱은 켠 뒤 15초, 그다음 6시간마다(설정에서 끌 수 있음) `releases/latest/download/latest.json`을 봅니다.
  새 버전이 있으면 알림과 상태 표시줄의 "새 버전" 버튼이 뜨고, 누르면 받아서 NSIS 설치본을 passive로 실행합니다.
  앱은 바로 끝나고, 설치가 끝나면 다시 켜져 "업데이트했습니다"를 알립니다(`src-tauri/src/update.rs`, 설정 폴더의 `updated-from.txt`).
- 서명: 설치본은 개인 키로 서명하고, 앱은 `tauri.conf.json`의 `plugins.updater.pubkey`로 확인합니다.
  - 개인 키: 이 PC의 `%USERPROFILE%\.tauri\nanogit.key` (저장소에 넣지 않음. 잃어버리면 이미 설치된 앱은 새 키로 서명한 업데이트를 받지 못하므로 한 번 더 손으로 설치해야 합니다).
  - CI: 저장소 Actions secret `TAURI_SIGNING_PRIVATE_KEY`(키 파일 내용), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(비밀번호, 지금은 빈 값).
  - secret이 없으면 main·PR 빌드는 서명 없이 만들고, 태그 빌드는 멈춥니다.
- 시험: `productName`·`identifier`·`version`과 `endpoints`(로컬 http, `dangerousInsecureTransportProtocol`)를 바꾼 `--config`로 두 버전을 빌드하면
  설치된 NanoGit과 설정(`%APPDATA%\<앱 이름>`)을 건드리지 않고 끝까지 시험할 수 있습니다.
