; NanoGit 설치 프로그램 훅 (tauri.conf.json의 bundle.windows.nsis.installerHooks)
; 이 파일은 UTF-8 BOM으로 저장한다 (NSIS가 한글 이름을 UTF-8로 읽도록).

; 제거할 때: 앱이 처음 켤 때 만든 바탕화면 "NanoGit 업데이트" 바로가기와 그 표시 파일을 지운다.
; 업데이트 설치(/UPDATE) 중에는 그대로 둔다.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    Delete "$DESKTOP\${PRODUCTNAME} 업데이트.lnk"
    Delete "$APPDATA\${PRODUCTNAME}\update-shortcut.txt"
  ${EndIf}
!macroend
