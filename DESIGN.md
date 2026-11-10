# Sip design

Sip is a water reminder and drink logger for one Android phone, a Pixel 6a. It replaces a Play Store app that takes several seconds to open. Two things matter more than anything else. The app opens near instantly, and reminders keep arriving.

"Sip" and the package id `app.sip` are placeholders.

## Speed budget

- A cold start paints the real main screen, with today's total, in under 500 ms on the Pixel 6a. That number is the median of 15 cold starts. The app calls `Activity.reportFullyDrawn()` once real data is on screen, and `sketches/measure-startup.sh` reads the "Fully drawn" time from logcat. The first frame of an empty WebView does not count.
- Logging from a reminder needs no app launch at all. The notification has a "+250 ml Water" button that writes the log from a `BroadcastReceiver`.

## Stack: Tauri 2 + Solid, by measurement

The rule was to build Tauri 2 + Solid first and keep it if it met the 500 ms budget. Solid is picked over React because its runtime is smaller, which only helps startup.

The sketch in `sketches/tauri-startup/` makes the real startup path. A Solid main screen gets its data from one Kotlin plugin call that reads SQLite, then calls `reportFullyDrawn()`. Results on the Pixel 6a with Android 17 and WebView 156, measured on 2026-11-10:

| Build state | Runs | Fully drawn, median | Range | First frame, median |
| --- | --- | --- | --- | --- |
| As installed | 15 | 301 ms | 278 to 424 ms | 86 ms |
| After `cmd package compile -m speed` | 15 | 296 ms | 283 to 361 ms | 92 ms |

- `am start -W` reported `LaunchState: COLD` for every launch, and no process existed before each one. All 30 runs reported Fully drawn.
- `sketches/tauri-startup/screen.png` shows the seeded data on screen, so the timer stops after real content paints.
- The first launch after install took 728 ms because it creates the database. Every launch after that is in the table.
- The WebView limits the number. In one timed run, the first frame was at 97 ms and Chromium started loading at 90 ms. The renderer process was ready at 196 ms, and the content painted at 342 ms. Native Kotlin would skip that WebView work.
- Not measured yet: the first launch after a reboot, and whether a white frame shows between the first frame and the content.

Rerun with `sketches/measure-startup.sh <package> 15`.

In both stacks Kotlin owns storage, alarms, receivers, and notifications. The alarm receiver and the notification button run with no UI on screen. If storage lived behind the WebView, Android would have to start a WebView just to write one row. So the two stacks differ only in the UI layer, and the Kotlin core below is the same.

## Data shape

### Domain types

These live in `domain/Model.kt`. They are plain Kotlin with no Android imports.

```kotlin
enum class AppIcon(val key: String) { DROPLET("droplet"), GLASS("glass"), /* generated, see Icons */ }

data class DrinkType(val id: Long, val label: String, val icon: AppIcon, val position: Int, val archived: Boolean)
data class Volume(val id: Long, val ml: Int, val label: String, val icon: AppIcon, val position: Int)
data class DrinkLog(val id: Long, val at: Instant, val ml: Int, val typeId: Long)

data class ReminderSettings(
	val enabled: Boolean,
	val intervalMinutes: Int,
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
) {
	val todayMl: Int get() = todayLogs.sumOf { it.ml }
	val lastDrinkAt: Instant? get() = todayLogs.maxOfOrNull { it.at }
}
```

### SQLite schema, version 1

The app uses plain `SQLiteOpenHelper`, with no Room and no annotation processing. Opening the database and reading a snapshot is five small queries over a few dozen rows.

```sql
CREATE TABLE drink_type (id INTEGER PRIMARY KEY, label TEXT NOT NULL, icon TEXT NOT NULL,
	position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE volume (id INTEGER PRIMARY KEY, ml INTEGER NOT NULL CHECK (ml > 0),
	label TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE drink_log (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL,
	ml INTEGER NOT NULL CHECK (ml > 0), type_id INTEGER NOT NULL REFERENCES drink_type(id));
CREATE INDEX drink_log_at ON drink_log(at_ms);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`kv` holds the settings and the reminder bookkeeping (`scheduled_for_ms`, `last_fired_ms`).

### Rules the repository enforces

`data/Repo.kt` is the only code that writes to the database. Receivers run in the app process, so a single in-process repository is enough and no cross-process locking is needed.

- A log copies `ml` from the volume. Editing or deleting a volume never rewrites history.
- A log points at its drink type by id. Deleting a type archives it, so pickers hide it and old logs still show its icon.
- At least one volume and one active drink type always exist. The repository refuses to delete the last one.
- Each log writes `lastVolumeId` and `lastTypeId`. The main screen preselects them on the next open. If the volume or type is gone, it falls back to the first one by position.
- A day runs from local midnight to local midnight.
- Icons are stored as their string key. An unknown key parses to `DROPLET` when the row is read, so a bad row never crashes the UI.

Seed data on first run:

- Drink types: Water, Coffee, Tea, Juice, Milk.
- Volumes: 150 ml, 250 ml, 330 ml, 500 ml, 750 ml.
- Goal: 2000 ml. Reminders: every 60 minutes from 08:00 to 22:00, paused once the goal is met.

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
3. One idempotent function, `Reconciler.reconcile(context)`, owns the alarm. It reads the snapshot and computes the next time with the pure `ReminderPlanner.next(now, zone, snapshot, lastFiredAt)`. It then sets or cancels the alarm and stores `scheduled_for_ms`. Running it twice changes nothing. It runs on app start (after the first frame), after every log change or settings change, when an alarm fires, when the notification button logs a drink, and on `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`, and `TIMEZONE_CHANGED`.
4. The planner rule:
	- `anchor` is the later of the last drink and the last reminder, and `candidate` is `anchor + interval`.
	- If `candidate` is in the past, `candidate` becomes now plus one minute. A reminder missed while the phone was off then fires right after boot.
	- Before `activeFrom`, `candidate` moves to `activeFrom` the same day. After `activeTo`, it moves to `activeFrom` the next day.
	- If the goal is met for `candidate`'s day and `pauseWhenGoalMet` is on, `candidate` moves to `activeFrom` the next day.
	- v1 requires `activeFrom` to be before `activeTo`. The settings screen validates it.
5. The notification channel is "Reminders" at `IMPORTANCE_HIGH`. The text reads "1 200 of 2 000 ml (60%)". The action button logs the preselected volume and type, then shows "Logged 250 ml, 1 450 ml (72%)" for five seconds. A tap on the notification opens the app. Logging a drink in the app removes any visible reminder.
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
 12:40   [cup]   Coffee   150 ml      tap a row to edit
--------------------------------------------------
 [Water] [Coffee] [Tea] [Juice] ...   drink types, scroll
 [150] [250] [330] [500] [750] ...    volumes with icons
 [            + DRINK  250 ml             ]
```

- The type chips, volume chips, and **+ DRINK** button sit at the bottom, in thumb reach. The last-used type and volume are preselected.
- A tap on **+ DRINK** logs the drink, gives a haptic tick, animates the ring, and shows "Logged 250 ml Water. Undo" for four seconds.
- A tap on a log row opens an editor for its volume, type, and time, so a drink you forgot to log can get the right time. The editor also has **Delete**.

### Settings

- **Daily goal** in ml, from 500 to 6000.
- **Volumes**. Each row shows a drag handle, icon, "250 ml", and an optional label. A tap opens an editor for ml, label, and icon. You can drag rows to reorder them, delete a row, or tap **Add volume**.
- **Drink types**. These use the same list editor, with label and icon.
- **Reminders**. On or off, an interval of 30, 45, 60, 90, or 120 minutes, active hours, and pause when the goal is met.
- **Reliability**. The checklist and the test button from the reminders section.

One list editor component serves both volumes and drink types.

## Icons

The icons come from Tabler Icons, outline style, which is MIT licensed and drawn with a single stroke color. `icons/icons.txt` lists the 15 to 20 icons the app uses. `icons/fetch-icons.sh` downloads exactly those SVGs from a pinned Tabler release and generates the platform files. For native, those are Android vector drawables plus the `AppIcon` enum. For Tauri, they are a TypeScript map of SVG paths. The script fails if a name doesn't exist upstream. To add an icon, add one line to `icons/icons.txt` and run the script again.

Candidate names to check against Tabler: `droplet`, `glass`, `glass-full`, `glass-cocktail`, `glass-champagne`, `bottle`, `baby-bottle`, `mug`, `cup`, `coffee`, `teapot`, `beer`, `milk`, `lemon-2`, `apple`, `leaf`, `bucket-droplet`.

## Module map

```
core (Kotlin, both stacks)
  domain/Model.kt            types above, no Android imports
  domain/ReminderPlanner.kt  pure next-reminder function, unit tested
  data/Db.kt                 SQLiteOpenHelper, schema, seed
  data/Repo.kt               only writer; snapshot() and a change listener
  reminders/Reconciler.kt    idempotent alarm owner
  reminders/AlarmReceiver.kt, DrinkActionReceiver.kt, SystemEventReceiver.kt
  reminders/Notifications.kt, Reliability.kt

native UI (if Tauri misses the budget)
  ui/MainActivity.kt, MainScreen.kt, SettingsScreen.kt
  ui/OrderedListEditor.kt, IconPicker.kt, AppIconRes.kt (generated)

Tauri UI (if Tauri meets the budget)
  Kotlin plugin SipPlugin exposes snapshot, logDrink, updateLog, deleteLog,
  saveVolume, deleteVolume, reorderVolumes, the same three for types,
  saveSettings, reliabilityStatus, and emits "changed"
  src/ Solid app with the same two screens
```

Native dependencies are AndroidX core, activity-compose, Compose Material 3, profileinstaller, and one small drag-to-reorder library. There is no DI framework, no Navigation library, and no Room. Two screens switch on one state value plus `BackHandler`. The release build uses R8 and a baseline profile.

## Later, not in v1

- History and per-day stats.
- A home screen widget and a Quick Settings tile, for logging without opening the app.
- A hydration factor per drink type, so beer can count less than water. In v1 every drink counts in full.
- Backup and export.
- A day that starts at 04:00 instead of midnight.
