fn main() {
    #[cfg(windows)]
    {
        let mut windows = tauri_build::WindowsAttributes::new();
        // 开发窗口保持普通权限，避免每次 cargo run 都弹 UAC；
        // 正式构建（release）默认以管理员身份启动。
        if std::env::var("PROFILE").as_deref() == Ok("release") {
            windows = windows.app_manifest(include_str!("handpulse-admin.manifest"));
        }
        tauri_build::try_build(
            tauri_build::Attributes::new().windows_attributes(windows),
        )
        .expect("failed to run tauri-build");
    }

    #[cfg(not(windows))]
    tauri_build::build();
}
