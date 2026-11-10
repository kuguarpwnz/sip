use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sip")
        .setup(|_app, api| {
            #[cfg(target_os = "android")]
            api.register_android_plugin("app.sip.core", "SipPlugin")?;
            #[cfg(not(target_os = "android"))]
            let _ = api;
            Ok(())
        })
        .build()
}
