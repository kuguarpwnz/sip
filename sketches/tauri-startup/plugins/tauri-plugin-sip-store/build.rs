const COMMANDS: &[&str] = &["snapshot", "fully_drawn"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
