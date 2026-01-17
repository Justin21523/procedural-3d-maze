#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // Linux WebKitGTK stability / compatibility toggles.
  //
  // Notes:
  // - `xapp-gtk3-module` warnings are harmless; they come from optional GTK modules.
  // - Some drivers / Wayland stacks can fail to render WebGL correctly; disabling DMABUF
  //   improves compatibility on a wider range of machines.
  #[cfg(target_os = "linux")]
  {
    // Avoid black/blank webview on some Linux/Wayland setups.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
      std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Optional: force a more conservative WebKit compositing mode.
    if std::env::var_os("P3DM_WEBKIT_NO_COMPOSITING").is_some()
      && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none()
    {
      std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    // Optional: force software OpenGL (slow, but helps on machines without working GPU drivers).
    if std::env::var_os("P3DM_SOFTWARE_GL").is_some() && std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
      std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
    }
  }

  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
