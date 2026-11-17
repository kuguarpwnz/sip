# Sip design

Sip is a water reminder and drink logger for one Android phone, a Pixel 6a. It replaces a Play Store app that takes several seconds to open. Two things matter more than anything else. The app opens near instantly, and reminders keep arriving.

"Sip" and the package id `app.sip` are placeholders.

## Speed budget

- A cold start paints the real main screen, with today's total, in under 500 ms on the Pixel 6a. That number is the median of 15 cold starts. The app calls `Activity.reportFullyDrawn()` once real data is on screen, and `scripts/measure-startup.sh` reads the "Fully drawn" time from logcat. The first frame of an empty WebView does not count.
- Logging from a reminder needs no app launch at all. The notification has a "+250 ml Water" button that writes the log from a `BroadcastReceiver`.

## Stack: Tauri 2 + Solid, by measurement

The rule was to build Tauri 2 + Solid first and keep it if it met the 500 ms budget. Solid is picked over React because its runtime is smaller, which only helps startup.

The sketch in `sketches/tauri-startup/` makes the real startup path. A Solid main screen gets its data from one Kotlin plugin call that reads SQLite, then calls `reportFullyDrawn()`. Results on the Pixel 6a with Android 17 and WebView 156, measured on 2026-11-10:

| Build state | Runs | Fully drawn, median | Range | First frame, median |
| --- | --- | --- | --- | --- |
| As installed | 15 | 301 ms | 278 to 424 ms | 86 ms |
| After `cmd package compile -m speed` | 15 | 296 ms | 283 to 361 ms | 92 ms |

- `am start -W` reported `LaunchState: COLD` for every launch, and no process existed before each one. All 30 runs reported Fully drawn.
- The screenshot taken during the run (on the `sketch/tauri-startup` branch) showed the seeded data on screen, so the timer stops after real content paints.
- The first launch after install took 728 ms because it creates the database. Every launch after that is in the table.
- The WebView limits the number. In one timed run, the first frame was at 97 ms and Chromium started loading at 90 ms. The renderer process was ready at 196 ms, and the content painted at 342 ms. Native Kotlin would skip that WebView work.
- Not measured yet: the first launch after a reboot, and whether a white frame shows between the first frame and the content.

Rerun with `scripts/measure-startup.sh <package> 15`.

In both stacks Kotlin owns storage, alarms, receivers, and notifications. The alarm receiver and the notification button run with no UI on screen. If storage lived behind the WebView, Android would have to start a WebView just to write one row. So the two stacks differ only in the UI layer, and the Kotlin core below is the same.

## Data shape

### Domain types

These live in `domain/Model.kt`. They are plain Kotlin with no Android imports.

```kotlin
enum class AppIcon(val key: String) { DROPLET("droplet"), GLASS("glass"), /* generated, see Icons */ }

data class DrinkType(val id: Long, val label: String, val icon: AppIcon, val position: Int, val archived: Boolean, val waterPct: Int)
data class Volume(val id: Long, val ml: Int, val label: String, val icon: AppIcon, val position: Int)
data class DrinkLog(val id: Long, val at: Instant, val ml: Int, val typeId: Long, val waterMl: Int) // waterMl is computed on read from the log's own water_pct

data class ReminderSettings(
	val enabled: Boolean,
	val intervalMinutes: Int,
	val quietAfterDrinkMinutes: Int,
	val activeFrom: LocalTime,
	val activeTo: LocalTime,
	val pauseWhenGoalMet: Boolean,
)

data class Settings(
	val dailyGoalMl: Int,
	val reminders: ReminderSettings,
	val lastVolumeId: Long?,
	val lastTypeId: Long?,
)

data class Snapshot(
	val settings: Settings,
	val types: List<DrinkType>,
	val volumes: List<Volume>,
	val todayLogs: List<DrinkLog>,
	val dayStart: Instant,
	val newestLog: DrinkLog?,   // latest at_ms on any day, highest id on a tie
	val preset: Preset,         // derived from newestLog, see Rules
) {
	val todayMl: Int get() = todayLogs.sumOf { it.waterMl }
	val lastDrinkAt: Instant? get() = newestLog?.at
}
```

### SQLite schema, version 2

The app uses plain `SQLiteOpenHelper`, with no Room and no annotation processing. Opening the database and reading a snapshot is five small queries over a few dozen rows.

```sql
CREATE TABLE drink_type (id INTEGER PRIMARY KEY, label TEXT NOT NULL, icon TEXT NOT NULL,
	position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
	water_pct INTEGER NOT NULL DEFAULT 100 CHECK (water_pct BETWEEN 0 AND 100));
CREATE TABLE volume (id INTEGER PRIMARY KEY, ml INTEGER NOT NULL CHECK (ml > 0),
	label TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE drink_log (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL,
	ml INTEGER NOT NULL CHECK (ml > 0), type_id INTEGER NOT NULL REFERENCES drink_type(id),
	water_pct INTEGER NOT NULL DEFAULT 100 CHECK (water_pct BETWEEN 0 AND 100));
CREATE INDEX drink_log_at ON drink_log(at_ms);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`kv` holds the settings and the reminder bookkeeping (`scheduled_for_ms`, `last_fired_ms`).

Version 2 added `drink_type.water_pct` and `drink_log.water_pct`, and dropped the `last_volume_id` and `last_type_id` kv rows. `onUpgrade` from version 1 adds both columns, so every existing type and log gets 100, and deletes the two rows.

### Rules the repository enforces

`data/Repo.kt` is the only code that writes to the database. Receivers run in the app process, so a single in-process repository is enough and no cross-process locking is needed.

- A log copies `ml` from the volume. Editing or deleting a volume never rewrites history.
- A log points at its drink type by id. Deleting a type archives it, so pickers hide it and old logs still show its icon.
- At least one volume and one active drink type always exist. The repository refuses to delete the last one.
- Nothing stores the last-used drink. The preset is derived on every read from the newest log, the one with the latest `at_ms` on any day, with the highest id winning a tie. `lastTypeId` is that log's type if it is active, else the first active type by position. `lastVolumeId` is the first volume by position whose `ml` equals that log's `ml`, else the first volume. With no logs, the preset is the first volume and the first active type. Editing, adding or deleting a log therefore moves it. `domain/Preset.kt` holds the rule.
- Water content is fixed when a drink is logged. Each log stores the `water_pct` its type had at that moment, and its water is `round(ml * water_pct / 100)`, rounding halves up, computed on read. Nothing stores water ml, so an ml edit scales correctly. `drink_type.water_pct` is only the default stamped onto new logs, so tuning a type changes no past day. `logDrink`, the notification button and `addLog` (Undo after a delete) stamp the type's current pct. `updateLog` keeps the stored pct when the type is unchanged, even if the amount or time changes, and takes the new type's current pct when the type changes. The goal ring, the totals, the notification text and `pauseWhenGoalMet` all count water. The log keeps its own `ml` for the "Logged 250 ml" text, the history row, undo and the editor.
- A day runs from local midnight to local midnight.
- Icons are stored as their string key. An unknown key parses to `DROPLET` when the row is read, so a bad row never crashes the UI.

Seed data on first run:

- Drink types, with their water content: Water 100%, Coffee 99%, Tea 99%, Juice 88%, Milk 88%. An upgraded install keeps 100% for every type.
- Volumes: 150 ml, 250 ml, 330 ml, 500 ml, 750 ml.
- Goal: 2000 ml. Reminders: every 60 minutes from 08:00 to 22:00, quiet for 60 minutes after a drink, paused once the goal is met.

`lastDrinkAt` is the time of that same newest log, so a drink at 23:50 still counts for the quiet window after midnight.

## Reminders that keep firing

### What Android does to alarms

These facts come from the official Android docs, read on 2026-11-10.

- In Doze, `setExactAndAllowWhileIdle()` still fires, but no more than once per nine minutes per app ([Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)). Reminders are at least 15 minutes apart, so the limit never applies.
- In Doze, WorkManager tasks don't run, and `setExact()` and `setWindow()` wait for the next maintenance window (same page). Many reminder apps go quiet for this reason.
- `setAlarmClock()` also fires in Doze. The system shows it to the user as an upcoming alarm, so the water reminder would replace the morning alarm as the phone's "next alarm".
- On Android 14 and later, `SCHEDULE_EXACT_ALARM` is denied by default. `USE_EXACT_ALARM` is granted at install and the user cannot revoke it. Google Play only allows it for alarm clock and calendar apps ([Schedule exact alarms are denied by default](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms)).
- An app in the "restricted" standby bucket can fire one alarm per day. Holding `USE_EXACT_ALARM` exempts the app from that bucket ([App Standby Buckets](https://developer.android.com/topic/performance/appstandby)).
- A reboot cancels every alarm ([Schedule alarms](https://developer.android.com/develop/background-work/services/alarms/schedule)).
- After a force stop, Android removes the app's alarms and blocks its receivers, `BOOT_COMPLETED` included, until the user opens the app again. Stock Android on a Pixel does not force-stop an app when you swipe it away.

### What Sip does

1. Sip is a sideloaded APK, so it declares `USE_EXACT_ALARM`. Publishing to Play later means switching to `SCHEDULE_EXACT_ALARM`, adding an in-app prompt, and falling back to `setAndAllowWhileIdle()` when the user refuses.
2. Exactly one alarm is pending at a time, set with `setExactAndAllowWhileIdle(RTC_WAKEUP, …)` and a fixed `PendingIntent`. Setting it again replaces the old one.
3. One idempotent function, `Reconciler.reconcile(context)`, owns the alarm. It reads the snapshot and computes the next time with the pure `ReminderPlanner.next(now, zone, settings, goalMl, todayMl, today, lastDrinkAt)`. It then sets or cancels the alarm and stores `scheduled_for_ms`. Running it twice changes nothing. It runs on app start (after the first frame), after every log change or settings change, when an alarm fires, when the notification button logs a drink, and on `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`, and `TIMEZONE_CHANGED`.
4. The planner rule:
	- Slots sit on a grid. For each local day, the slots are `activeFrom + k * interval` for k = 0, 1, 2 and so on, while the time is at most `activeTo`. They are wall-clock times, so the grid stays put across DST changes. A slot never wraps past midnight.
	- The next reminder is the earliest slot that is strictly after now, and at or after `lastDrinkAt + quietAfterDrink`. A drink skips the slots inside its quiet window and never moves the grid. With interval 30 and quiet 60, a drink at 09:23 gives 10:30. A slot exactly `quietAfterDrink` after the drink still fires, and with a quiet time of 0 a drink skips nothing.
	- If `pauseWhenGoalMet` is on and today's total has reached the goal, no slot today counts. Slots on later days are unaffected.
	- The planner looks at today and the next two days. The quiet window is at most four hours, so one of them always has a slot.
	- A slot missed while the phone was off is skipped. The missed-reminder card still reports it until the next reminder fires.
	- v1 requires `activeFrom` to be before `activeTo`. The settings screen validates it.
5. The notification channel is "Reminders" at `IMPORTANCE_HIGH`. The text reads "1 200 of 2 000 ml (60%)". The action button repeats the newest drink exactly: its `ml` and type, labelled "+{ml} ml {type}". With no logs it uses the first volume and the first active type. It then shows "Logged 250 ml, 1 450 ml (72%)" for one second. If logging fails, it posts "Couldn't log the drink" instead. A tap on the notification opens the app. Logging a drink in the app removes any visible reminder.
6. Missed-reminder check. `AlarmReceiver` writes `last_fired_ms`. On app start, if `scheduled_for_ms` is more than 10 minutes in the past and `last_fired_ms` is older than it, the main screen shows "The 14:00 reminder didn't arrive" with a **Fix** button.
7. Reliability checklist in settings. It shows four checks, each with a button that opens the right system screen. The checks are notifications allowed (`POST_NOTIFICATIONS` and the channel not muted), exact alarms allowed (`canScheduleExactAlarms()`), and battery usage set to Unrestricted (`isIgnoringBatteryOptimizations()`, requested with `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`). A **Send test reminder in 1 minute** button runs the whole path once.

## Screens

### Main

```
Today                                   [settings]
                 ( 64% ring )
              1 280 / 2 000 ml
            last drink 25 min ago
--------------------------------------------------
 14:05   [drop]  Water    250 ml
 12:40   [cup]   Coffee   150 ml      tap picks, hold edits
--------------------------------------------------
 [Water] [Coffee] [Tea] [Juice] ...   drink types, scroll
 [150] [250] [330] [500] [750] ...    volumes with icons
 [            + DRINK  250 ml             ]
```

- The type chips, volume chips, and **+ DRINK** button sit at the bottom, in thumb reach. The last-used type and volume are preselected.
- A tap on **+ DRINK** logs the drink, gives a haptic tick, animates the ring, and shows "Logged 250 ml Water. Undo" for four seconds.
- A history row whose water differs from its amount shows a muted second line under the ml, "220 ml water".
- A tap on a log row selects that drink's type and volume in the chip rows, ready for **+ DRINK**, so a repeat drink takes two taps. It logs nothing. If the type is archived or no volume matches the amount, that chip stays as it was and a toast says so.
- A long press on a log row (450 ms, with a haptic tick) opens the edit sheet for that drink, for its volume, type, and time, so a drink you forgot to log can get the right time. The sheet includes **Delete**, which removes the drink and shows "Deleted 400 ml Tea. Undo".

- **Experiment: pick from a list.** A setting under Settings, Experiments ("Pick drinks from a list", localStorage `sip.picker` = `list`) swaps the two chip rows for one button that opens a "Choose drink" sheet with a vertical list of types and one of volumes. `src/PickerList.tsx` owns the signal, the button and the sheet. To delete the experiment, delete that file and these lines. In `store.ts`, the `| { kind: "picker" }` layer variant. In `App.tsx`, the `PickerSheet` import and its `<Show when={layerOf("picker")}>` block. In `Main.tsx`, the `PickerButton, pickFromList` import and the `<Show when={pickFromList()} fallback=...>` wrapper (keep the chip rows). In `Settings.tsx`, the `pickFromList, setPickFromList` import and the Experiments section. In `app.css`, the `.picker-btn` and `.pick-*` rules. Delete `src/picker.test.tsx`. The shared `drink()` in `store.ts` stays. To keep the list instead, delete the two `ChipRow`s and `PickerList.tsx`'s toggle.

### Settings

- **Daily goal** in ml, from 500 to 6000.
- **Volumes**. Each row shows a drag handle, icon, "250 ml", and an optional label. A tap opens an editor for ml, label, and icon. You can drag rows to reorder them, delete a row, or tap **Add volume**.
- **Drink types**. These use the same list editor, with label, icon and water content (0 to 100%, 100 for a new type). A row with less than 100% shows "88% water" as its second line. The editor notes that a new percentage applies to drinks logged from now on.
- **Reminders**. On or off, the interval in minutes (15 to 240), quiet after a drink in minutes (0 to 240), the active hours start and end, and pause when the goal is met.
- **Reliability**. The checklist and the test button from the reminders section.

One list editor component serves both volumes and drink types.

## Icons

The icons come from Tabler Icons, outline style, which is MIT licensed and drawn with a single stroke color. `@tabler/icons` is a pinned dev dependency, so it never ships in the APK. `icons/icons.txt` lists the 15 to 20 icons the app uses. `icons/generate.mjs` reads exactly those SVGs and writes two files. `src/icons.gen.ts` maps each key to its SVG inner markup. `IconKeys.kt` in the plugin holds the set of valid keys, so the database boundary can reject unknown ones. The script fails if a name doesn't exist in the package. To add an icon, add one line to `icons/icons.txt` and run `node icons/generate.mjs`.

Candidate names to check against Tabler: `droplet`, `glass`, `glass-full`, `glass-cocktail`, `glass-champagne`, `bottle`, `baby-bottle`, `mug`, `cup`, `coffee`, `teapot`, `beer`, `milk`, `lemon-2`, `apple`, `leaf`, `bucket-droplet`.

## Repository layout

The app grows out of `sketches/tauri-startup/`, which moves to the repository root. The application id is `app.sip`, and the app label is "Sip".

```
package.json, index.html, vite.config.ts   Solid app build
src/
  api.ts                 typed wrapper for every plugin command
  icons.gen.ts           generated by icons/generate.mjs
  (screens and components)
src-tauri/               Rust app shell and the generated Android project
plugins/tauri-plugin-sip/
  src/                   Rust command bindings and permissions
  android/src/main/java/app/sip/core/
    SipPlugin.kt         commands and the "changed" event
    domain/Model.kt, domain/ReminderPlanner.kt
    data/Db.kt, data/Repo.kt, data/Json.kt, data/IconKeys.kt (generated)
    reminders/           Reconciler, receivers, Notifications, Reliability
  android/src/main/AndroidManifest.xml
  android/src/test/      JUnit tests for ReminderPlanner and Repo rules
icons/icons.txt, icons/generate.mjs
scripts/build-apk.sh     build, sign, verify
scripts/measure-startup.sh
scripts/emulator.sh      start or reuse the test emulator, print its serial
scripts/release.sh       bump the version, build, tag, push, publish a GitHub release
```

There are no Android dependencies beyond what Tauri brings, plus `org.json` and `android.database.sqlite` from the platform. The Settings screen is code-split with Solid's `lazy()`, so its code never loads on the startup path.

## Testing

- `pnpm test` runs the UI tests against the fake host on the Mac.
- `export ANDROID_SERIAL=$(scripts/emulator.sh)` starts the emulator, or reuses the running one, and prints its serial. `scripts/emulator.sh --window` shows its window and `--stop` shuts it down.
- Install the debug APK on it and run `node scripts/smoke-api.mjs`.
- The Kotlin unit tests run with `cd src-tauri/gen/android && ./gradlew :tauri-plugin-sip:testDebugUnitTest`.
- Startup timing (`scripts/measure-startup.sh`) needs the real phone. Emulator numbers don't count against the 500 ms budget.
- The release build's WebView is inspectable too (`MainActivity.kt`), so a script on a USB-debugging Mac can call the plugin commands on `app.sip` the way smoke-api does on `app.sip.debug`. It only answers while the phone is unlocked with Sip in front. Never point smoke-api at `app.sip`, because it wipes data.

## Plugin API

The plugin is named `sip`. `src/api.ts` is the only file that calls `invoke`. Every command that changes data returns the new `Snapshot`, and the UI replaces its whole state with it. A rejected command carries a message the UI shows as a toast.

JSON shapes, as TypeScript:

```ts
type IconKey = string; // one of ICON_KEYS from icons.gen.ts
interface DrinkType { id: number; label: string; icon: IconKey; position: number; archived: boolean; waterPct: number }
interface Volume { id: number; ml: number; label: string; icon: IconKey; position: number }
interface DrinkLog { id: number; atMs: number; ml: number; typeId: number; waterMl: number } // computed on read
interface ReminderSettings {
	enabled: boolean; intervalMin: number; quietAfterDrinkMin: number;
	activeFrom: string; activeTo: string; // "HH:mm"
	pauseWhenGoalMet: boolean;
}
interface Settings { dailyGoalMl: number; reminders: ReminderSettings; lastVolumeId: number | null; lastTypeId: number | null } // last* are derived, see Rules
interface Snapshot {
	settings: Settings; types: DrinkType[]; volumes: Volume[];
	todayLogs: DrinkLog[]; dayStartMs: number; lastDrinkAtMs: number | null;
}
interface ReminderStatus {
	notificationsAllowed: boolean; channelEnabled: boolean; exactAlarmsAllowed: boolean;
	batteryUnrestricted: boolean; nextReminderAtMs: number | null; missedReminderAtMs: number | null;
}
```

`types` includes archived types, so old logs can still show their icon. Pickers filter them out.

| Command | Arguments | Returns |
| --- | --- | --- |
| `snapshot` | none | `Snapshot` |
| `logDrink` | `volumeId`, `typeId` | `Snapshot`. Copies `ml` from the volume. |
| `addLog` | `atMs`, `ml`, `typeId` | `Snapshot`. Undo for a deleted log. |
| `updateLog` | `id`, `atMs`, `ml`, `typeId` | `Snapshot` |
| `deleteLog` | `id` | `Snapshot` |
| `saveVolume` | `id` (absent for new), `ml`, `label`, `icon` | `Snapshot`. A new volume goes last. |
| `deleteVolume` | `id` | `Snapshot`. Rejects the last volume. |
| `reorderVolumes` | `ids` in the new order | `Snapshot` |
| `saveType`, `deleteType`, `reorderTypes` | same pattern, with `label`, `icon` and `waterPct` (0 to 100, required) | `Snapshot`. Delete archives the type and rejects the last active one. |
| `saveSettings` | `dailyGoalMl` and `reminders`, each optional | `Snapshot` |
| `reminderStatus` | none | `ReminderStatus` |
| `openSystemSettings` | `target`: `notifications`, `exactAlarms`, `battery`, or `app` | nothing |
| `sendTestReminder` | none | nothing. A reminder arrives in 60 seconds. |
| `haptic` | none | nothing. Android WebView ignores `navigator.vibrate`. |
| `fullyDrawn` | none | nothing. Calls `reportFullyDrawn()`, then reconciles reminders off the main thread. |

The plugin also emits a `changed` event with a `Snapshot` after any write that didn't come from the UI, such as the notification button. Notification permission uses Tauri's built-in `checkPermissions` and `requestPermissions` with the alias `notifications`.

`saveSettings` validates input. The goal must be 500 to 6000 ml, the interval 15 to 240 minutes, and the quiet time 0 to 240 minutes, and `activeFrom` must come before `activeTo`. Labels must be 1 to 24 characters, `ml` 10 to 3000, `waterPct` 0 to 100, and icon keys must be in `IconKeys`.

## Build order and file ownership

1. The core delegate does the blocking work. It moves the sketch to the root and renames it. It writes the domain, the planner and its tests, the database, the repository, every command, `api.ts`, the icon generator, the app icon, and signing. It leaves `reminders/` as no-op stubs, so `Reconciler.reconcile()` exists and does nothing.
2. Two delegates then work in parallel, each in its own git worktree.
	- The reminders delegate owns `reminders/`, the plugin `AndroidManifest.xml`, and the notification icon. It is the only one that uses the phone in this phase.
	- The UI delegate owns `src/`, except `api.ts` and `icons.gen.ts`. It checks layouts in a desktop browser against a development-only mock of `api.ts`, which never reaches the release bundle.
3. I merge both, then verify everything on the Pixel. That includes startup, which must stay under 500 ms.

## Later, not in v1

- History and per-day stats.
- A home screen widget and a Quick Settings tile, for logging without opening the app.
- Backup and export.
- A day that starts at 04:00 instead of midnight.
