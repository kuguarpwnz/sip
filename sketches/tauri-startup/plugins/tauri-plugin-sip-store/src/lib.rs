use serde_json::Value;
use tauri::{
    command,
    plugin::{Builder, PluginApi, TauriPlugin},
    AppHandle, Manager, Runtime,
};

mod error;
pub use error::{Error, Result};

#[cfg(mobile)]
struct SipStore<R: Runtime>(tauri::plugin::PluginHandle<R>);
#[cfg(desktop)]
struct SipStore<R: Runtime>(std::marker::PhantomData<R>);

#[command]
async fn snapshot<R: Runtime>(app: AppHandle<R>) -> Result<Value> {
    #[cfg(mobile)]
    return Ok(app.state::<SipStore<R>>().0.run_mobile_plugin_async("snapshot", ()).await?);
    #[cfg(desktop)]
    return {
        let _ = app;
        Err(Error::Unsupported)
    };
}

#[command]
async fn fully_drawn<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    #[cfg(mobile)]
    return Ok(app.state::<SipStore<R>>().0.run_mobile_plugin_async("fullyDrawn", ()).await?);
    #[cfg(desktop)]
    return {
        let _ = app;
        Err(Error::Unsupported)
    };
}

fn register<R: Runtime>(_app: &AppHandle<R>, api: PluginApi<R, ()>) -> Result<SipStore<R>> {
    #[cfg(target_os = "android")]
    return Ok(SipStore(
        api.register_android_plugin("app.sip.sketch.store", "SipStorePlugin")?,
    ));
    #[cfg(not(target_os = "android"))]
    {
        let _ = api;
        #[cfg(mobile)]
        compile_error!("Android only");
        #[cfg(desktop)]
        return Ok(SipStore(std::marker::PhantomData));
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sip-store")
        .invoke_handler(tauri::generate_handler![snapshot, fully_drawn])
        .setup(|app, api| {
            app.manage(register(app, api)?);
            Ok(())
        })
        .build()
}
