// Every command is implemented in Kotlin. Tauri forwards plugin commands that have no Rust
// handler to the Android plugin as lowerCamelCase (log_drink becomes logDrink), so this list only
// feeds the ACL permission generator.
const COMMANDS: &[&str] = &[
    "snapshot",
    "logs_between",
    "log_drink",
    "add_log",
    "update_log",
    "delete_log",
    "save_volume",
    "delete_volume",
    "reorder_volumes",
    "save_type",
    "delete_type",
    "reorder_types",
    "save_settings",
    "reminder_status",
    "open_system_settings",
    "send_test_reminder",
    "haptic",
    "fully_drawn",
    "check_permissions",
    "request_permissions",
    "register_listener",
    "remove_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
