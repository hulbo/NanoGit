//! 바탕화면의 "NanoGit 업데이트" 바로가기: `nanogit.exe --update`를 실행해 바로 새 버전을 받아 설치한다.
//! 설치본이 처음 켜질 때 한 번 만들고 설정 폴더에 표시를 남긴다. 사용자가 지운 뒤에는 다시 만들지 않고,
//! 설정의 "바탕화면에 만들기"로 다시 만들 수 있다. 제거할 때는 설치 프로그램이 지운다 (`windows/hooks.nsh`).

use std::path::{Path, PathBuf};

/// 바로가기가 넘기는 인자. 이미 떠 있으면 single-instance가 넘겨 받아 화면에 알린다
pub const UPDATE_ARG: &str = "--update";
/// 바로가기를 한 번 만들었다는 표시 (설정 폴더). 제거할 때 설치 프로그램이 함께 지운다
const MADE: &str = "update-shortcut.txt";

/// 바탕화면의 바로가기 경로: "<앱 이름> 업데이트.lnk"
pub fn link_path(desktop: &Path, app_name: &str) -> PathBuf {
    desktop.join(format!("{app_name} 업데이트.lnk"))
}

fn desktop_link(app_name: &str) -> Result<PathBuf, String> {
    let desktop = dirs::desktop_dir().ok_or("바탕화면 폴더를 찾지 못했습니다")?;
    Ok(link_path(&desktop, app_name))
}

/// 처음 한 번만 만든다. 만들었으면 true (이미 만든 적이 있으면 false)
pub fn ensure_once(data_dir: &Path, link: &Path, exe: &Path) -> Result<bool, String> {
    let made = data_dir.join(MADE);
    if made.exists() {
        return Ok(false);
    }
    create(link, exe)?;
    std::fs::write(&made, link.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 앱을 켤 때: 설치본이면 처음 한 번 바로가기를 만든다 (개발 빌드·NANOGIT_HOME 실행은 건너뜀)
pub fn ensure_on_start(data_dir: PathBuf, app_name: String) {
    if cfg!(debug_assertions) || crate::store::Store::uses_custom_dir() {
        return;
    }
    std::thread::spawn(move || {
        let made = std::env::current_exe()
            .map_err(|e| e.to_string())
            .and_then(|exe| ensure_once(&data_dir, &desktop_link(&app_name)?, &exe));
        if let Err(e) = made {
            eprintln!("업데이트 바로가기를 만들지 못했습니다: {e}");
        }
    });
}

/// 설정의 "바탕화면에 만들기": 지금 실행 중인 NanoGit으로 바로가기를 (다시) 만들고 경로를 돌려준다
#[tauri::command]
pub async fn update_shortcut(app: tauri::AppHandle) -> Result<String, String> {
    let name = app.package_info().name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let link = desktop_link(&name)?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        create(&link, &exe)?;
        Ok(crate::git::display(&link))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 바로가기 파일을 만든다 (있으면 덮어씀): 대상 exe, 인자 --update, 아이콘은 exe의 것
#[cfg(windows)]
fn create(link: &Path, exe: &Path) -> Result<(), String> {
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    use windows::core::{HSTRING, Interface};

    let save = || -> windows::core::Result<()> {
        unsafe {
            let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            shell.SetPath(&HSTRING::from(exe))?;
            shell.SetArguments(&HSTRING::from(UPDATE_ARG))?;
            if let Some(dir) = exe.parent() {
                shell.SetWorkingDirectory(&HSTRING::from(dir))?;
            }
            shell.SetIconLocation(&HSTRING::from(exe), 0)?;
            shell.SetDescription(&HSTRING::from("NanoGit을 최신 버전으로 업데이트합니다"))?;
            shell.cast::<IPersistFile>()?.Save(&HSTRING::from(link), true)
        }
    };
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = save();
        if init.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| format!("바로가기를 만들지 못했습니다: {e}"))
    }
}

#[cfg(not(windows))]
fn create(_link: &Path, _exe: &Path) -> Result<(), String> {
    Err("Windows에서만 바로가기를 만듭니다".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// 만든 바로가기를 다시 읽는다: (대상, 인자)
    fn read(link: &Path) -> (String, String) {
        use windows::Win32::System::Com::{
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, IPersistFile, STGM_READ,
        };
        use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
        use windows::core::{HSTRING, Interface};
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            shell.cast::<IPersistFile>().unwrap().Load(&HSTRING::from(link), STGM_READ).unwrap();
            let mut target = [0u16; 260];
            shell.GetPath(&mut target, std::ptr::null_mut(), 0).unwrap();
            let mut args = [0u16; 260];
            shell.GetArguments(&mut args).unwrap();
            let s = |b: &[u16]| String::from_utf16_lossy(&b[..b.iter().position(|&c| c == 0).unwrap_or(b.len())]);
            (s(&target), s(&args))
        }
    }

    #[test]
    fn link_name() {
        assert_eq!(link_path(Path::new("C:/d"), "NanoGit"), Path::new("C:/d").join("NanoGit 업데이트.lnk"));
    }

    #[test]
    fn creates_once_and_not_again_after_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let exe_dir = tmp.path().join("설치 폴더");
        std::fs::create_dir(&exe_dir).unwrap();
        let exe = exe_dir.join("nanogit.exe");
        std::fs::write(&exe, b"").unwrap();
        let link = link_path(tmp.path(), "NanoGit");

        assert_eq!(ensure_once(tmp.path(), &link, &exe), Ok(true));
        let (target, args) = read(&link);
        assert_eq!(Path::new(&target), exe);
        assert_eq!(args, UPDATE_ARG);

        // 사용자가 지우면 다시 만들지 않는다
        std::fs::remove_file(&link).unwrap();
        assert_eq!(ensure_once(tmp.path(), &link, &exe), Ok(false));
        assert!(!link.exists());

        // 설정에서 다시 만들기
        create(&link, &exe).unwrap();
        assert_eq!(read(&link).1, UPDATE_ARG);
    }
}
