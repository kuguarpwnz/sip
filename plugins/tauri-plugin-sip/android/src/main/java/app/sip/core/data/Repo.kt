package app.sip.core.data

import android.content.Context
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import app.sip.core.domain.DrinkLog
import app.sip.core.domain.DrinkType
import app.sip.core.domain.LogInput
import app.sip.core.domain.Logged
import app.sip.core.domain.Preset
import app.sip.core.domain.ReminderPlanner
import app.sip.core.domain.ReminderSettings
import app.sip.core.domain.Rejected
import app.sip.core.domain.Settings
import app.sip.core.domain.SettingsPatch
import app.sip.core.domain.Snapshot
import app.sip.core.domain.TypeInput
import app.sip.core.domain.waterMlOf
import app.sip.core.domain.waterPctAfterEdit
import app.sip.core.domain.Volume
import app.sip.core.domain.VolumeInput
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArraySet

fun interface ChangeListener {
    fun onChanged(snapshot: Snapshot)
}

/**
 * The only writer. Receivers and the plugin share one instance per process, so `@Synchronized`
 * is the whole concurrency story. Get it with `Repo.get(context)`.
 */
class Repo private constructor(context: Context) {
    private val helper = Db(context)
    private val listeners = CopyOnWriteArraySet<ChangeListener>()

    companion object {
        @Volatile private var instance: Repo? = null

        private const val LOG_SELECT =
            "SELECT id, at_ms, ml, type_id, water_pct FROM drink_log"

        fun get(context: Context): Repo =
            instance ?: synchronized(this) {
                instance ?: Repo(context.applicationContext).also { instance = it }
            }
    }

    fun addListener(listener: ChangeListener) {
        listeners.add(listener)
    }

    fun removeListener(listener: ChangeListener) {
        listeners.remove(listener)
    }

    /** Call after writing outside the UI, so an open WebView hears about it. */
    fun notifyChanged() {
        if (listeners.isEmpty()) return
        val snapshot = snapshot()
        listeners.forEach { it.onChanged(snapshot) }
    }

    @Synchronized
    fun snapshot(now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): Snapshot =
        readSnapshot(helper.writableDatabase, now, zone)

    @Synchronized
    fun logDrink(volumeId: Long, typeId: Long, at: Instant = Instant.now()): Logged = tx { db ->
        val volume = findVolume(db, volumeId) ?: throw Rejected("Volume not found")
        val type = findType(db, typeId) ?: throw Rejected("Drink type not found")
        if (type.archived) throw Rejected("Drink type was deleted")
        val log = insertLog(db, at, volume.ml, type)
        Logged(log, type, readSnapshot(db, at))
    }

    /** What the notification button logs: the newest drink again, or the first volume and type when there is none. */
    @Synchronized
    fun logPreselected(at: Instant = Instant.now()): Logged = tx { db ->
        val before = readSnapshot(db, at)
        val ml = before.preset.ml ?: throw Rejected("No volume")
        val type = before.types.firstOrNull { it.id == before.preset.typeId } ?: throw Rejected("No drink type")
        val log = insertLog(db, at, ml, type)
        Logged(log, type, readSnapshot(db, at))
    }

    @Synchronized
    fun addLog(input: LogInput): Snapshot = tx { db ->
        val type = findType(db, input.typeId) ?: throw Rejected("Drink type not found")
        insertLog(db, input.at, input.ml, type)
        readSnapshot(db)
    }

    @Synchronized
    fun updateLog(input: LogInput): Snapshot = tx { db ->
        val type = findType(db, input.typeId) ?: throw Rejected("Drink type not found")
        val id = input.id ?: throw Rejected("Missing id")
        val (oldTypeId, storedPct) = db.rawQuery("SELECT type_id, water_pct FROM drink_log WHERE id = ?", arrayOf(id.toString())).use {
            if (it.moveToFirst()) it.getLong(0) to it.getInt(1) else throw Rejected("Log not found")
        }
        val values = ContentValues().apply {
            put("at_ms", input.at.toEpochMilli()); put("ml", input.ml); put("type_id", input.typeId)
            put("water_pct", waterPctAfterEdit(storedPct, oldTypeId, type))
        }
        if (db.update("drink_log", values, "id = ?", arrayOf(id.toString())) == 0) throw Rejected("Log not found")
        readSnapshot(db)
    }

    @Synchronized
    fun deleteLog(id: Long): Snapshot = tx { db ->
        db.delete("drink_log", "id = ?", arrayOf(id.toString()))
        readSnapshot(db)
    }

    @Synchronized
    fun saveVolume(input: VolumeInput): Snapshot = tx { db ->
        if (input.id == null) {
            db.execSQL(
                "INSERT INTO volume (ml, label, icon, position) " +
                    "VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM volume))",
                arrayOf<Any>(input.ml, input.label, input.icon.key),
            )
        } else {
            val values = ContentValues().apply { put("ml", input.ml); put("label", input.label); put("icon", input.icon.key) }
            if (db.update("volume", values, "id = ?", arrayOf(input.id.toString())) == 0) throw Rejected("Volume not found")
        }
        readSnapshot(db)
    }

    @Synchronized
    fun deleteVolume(id: Long): Snapshot = tx { db ->
        findVolume(db, id) ?: throw Rejected("Volume not found")
        if (count(db, "SELECT COUNT(*) FROM volume") <= 1) throw Rejected("Keep at least one volume")
        db.delete("volume", "id = ?", arrayOf(id.toString()))
        readSnapshot(db)
    }

    @Synchronized
    fun reorderVolumes(ids: List<Long>): Snapshot = tx { db ->
        val existing = readVolumes(db).map { it.id }
        if (ids.toSet() != existing.toSet()) throw Rejected("The order must list every volume once")
        ids.forEachIndexed { position, id -> setPosition(db, "volume", id, position) }
        readSnapshot(db)
    }

    @Synchronized
    fun saveType(input: TypeInput): Snapshot = tx { db ->
        if (input.id == null) {
            db.execSQL(
                "INSERT INTO drink_type (label, icon, water_pct, position) " +
                    "VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM drink_type))",
                arrayOf<Any>(input.label, input.icon.key, input.waterPct),
            )
        } else {
            val values = ContentValues().apply {
                put("label", input.label); put("icon", input.icon.key); put("water_pct", input.waterPct)
            }
            if (db.update("drink_type", values, "id = ?", arrayOf(input.id.toString())) == 0) throw Rejected("Drink type not found")
        }
        readSnapshot(db)
    }

    /** Archives instead of deleting, so old logs keep their type. */
    @Synchronized
    fun deleteType(id: Long): Snapshot = tx { db ->
        val type = findType(db, id) ?: throw Rejected("Drink type not found")
        if (!type.archived) {
            if (count(db, "SELECT COUNT(*) FROM drink_type WHERE archived = 0") <= 1) {
                throw Rejected("Keep at least one drink type")
            }
            db.execSQL("UPDATE drink_type SET archived = 1 WHERE id = ?", arrayOf<Any>(id))
        }
        readSnapshot(db)
    }

    /** `ids` must name every active type. Archived types may be left out and keep their order after them. */
    @Synchronized
    fun reorderTypes(ids: List<Long>): Snapshot = tx { db ->
        val types = readTypes(db)
        val active = types.filter { !it.archived }.map { it.id }.toSet()
        if (ids.any { id -> types.none { it.id == id } } || !ids.containsAll(active)) {
            throw Rejected("The order must list every drink type once")
        }
        val rest = types.map { it.id }.filter { it !in ids }
        (ids + rest).forEachIndexed { position, id -> setPosition(db, "drink_type", id, position) }
        readSnapshot(db)
    }

    @Synchronized
    fun saveSettings(patch: SettingsPatch): Snapshot = tx { db ->
        val current = readSettings(readKv(db), Preset.derive(null, emptyList(), emptyList()))
        val r = current.reminders
        val p = patch.reminders
        val merged = ReminderSettings(
            enabled = p?.enabled ?: r.enabled,
            intervalMinutes = p?.intervalMinutes ?: r.intervalMinutes,
            quietAfterDrinkMinutes = p?.quietAfterDrinkMinutes ?: r.quietAfterDrinkMinutes,
            activeFrom = p?.activeFrom ?: r.activeFrom,
            activeTo = p?.activeTo ?: r.activeTo,
            pauseWhenGoalMet = p?.pauseWhenGoalMet ?: r.pauseWhenGoalMet,
        )
        if (!merged.activeFrom.isBefore(merged.activeTo)) throw Rejected("Active hours must start before they end")

        patch.dailyGoalMl?.let { setKv(db, Kv.DAILY_GOAL_ML, it.toString()) }
        setKv(db, Kv.REMINDERS_ENABLED, if (merged.enabled) "1" else "0")
        setKv(db, Kv.INTERVAL_MIN, merged.intervalMinutes.toString())
        setKv(db, Kv.QUIET_AFTER_DRINK_MIN, merged.quietAfterDrinkMinutes.toString())
        setKv(db, Kv.ACTIVE_FROM, Json.formatTime(merged.activeFrom))
        setKv(db, Kv.ACTIVE_TO, Json.formatTime(merged.activeTo))
        setKv(db, Kv.PAUSE_WHEN_GOAL_MET, if (merged.pauseWhenGoalMet) "1" else "0")
        readSnapshot(db)
    }

    @Synchronized
    fun lastReminderAt(): Instant? = getKv(Kv.LAST_FIRED_MS)?.toLongOrNull()?.let(Instant::ofEpochMilli)

    @Synchronized
    fun setLastReminderAt(at: Instant) = tx { db -> setKv(db, Kv.LAST_FIRED_MS, at.toEpochMilli().toString()) }

    @Synchronized
    fun scheduledFor(): Instant? = getKv(Kv.SCHEDULED_FOR_MS)?.toLongOrNull()?.let(Instant::ofEpochMilli)

    @Synchronized
    fun setScheduledFor(at: Instant?) = tx { db ->
        if (at == null) db.delete("kv", "key = ?", arrayOf(Kv.SCHEDULED_FOR_MS))
        else setKv(db, Kv.SCHEDULED_FOR_MS, at.toEpochMilli().toString())
    }

    /** The reminder that was due but never fired. The reconciler sets it, and a reminder that fires clears it. */
    @Synchronized
    fun missedReminderAt(): Instant? = getKv(Kv.MISSED_REMINDER_MS)?.toLongOrNull()?.let(Instant::ofEpochMilli)

    @Synchronized
    fun setMissedReminderAt(at: Instant?) = tx { db ->
        if (at == null) db.delete("kv", "key = ?", arrayOf(Kv.MISSED_REMINDER_MS))
        else setKv(db, Kv.MISSED_REMINDER_MS, at.toEpochMilli().toString())
    }

    @Synchronized
    fun nextReminderAt(now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): Instant? {
        val s = snapshot(now, zone)
        return ReminderPlanner.next(
            now = now,
            zone = zone,
            settings = s.settings.reminders,
            goalMl = s.settings.dailyGoalMl,
            todayMl = s.todayMl,
            today = now.atZone(zone).toLocalDate(),
            lastDrinkAt = s.lastDrinkAt,
        )
    }

    private inline fun <T> tx(block: (SQLiteDatabase) -> T): T {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            val result = block(db)
            db.setTransactionSuccessful()
            return result
        } finally {
            db.endTransaction()
        }
    }

    private fun readSnapshot(
        db: SQLiteDatabase,
        now: Instant = Instant.now(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): Snapshot {
        val today = now.atZone(zone).toLocalDate()
        val dayStart = today.atStartOfDay(zone).toInstant()
        val dayEnd = today.plusDays(1).atStartOfDay(zone).toInstant()
        val volumes = readVolumes(db)
        val types = readTypes(db)
        val logs = ArrayList<DrinkLog>()
        db.rawQuery(
            "$LOG_SELECT WHERE at_ms >= ? AND at_ms < ? ORDER BY at_ms DESC, id DESC",
            arrayOf(dayStart.toEpochMilli().toString(), dayEnd.toEpochMilli().toString()),
        ).use { while (it.moveToNext()) logs.add(readLog(it)) }
        val newest = db.rawQuery("$LOG_SELECT ORDER BY at_ms DESC, id DESC LIMIT 1", null).use {
            if (it.moveToFirst()) readLog(it) else null
        }
        val preset = Preset.derive(newest, types, volumes)
        return Snapshot(readSettings(readKv(db), preset), types, volumes, logs, dayStart, newest, preset)
    }

    private fun readLog(c: android.database.Cursor): DrinkLog {
        val ml = c.getInt(2)
        return DrinkLog(c.getLong(0), Instant.ofEpochMilli(c.getLong(1)), ml, c.getLong(3), waterMlOf(ml, c.getInt(4)))
    }

    private fun readSettings(kv: Map<String, String>, preset: Preset): Settings {
        val reminders = ReminderSettings(
            enabled = kv[Kv.REMINDERS_ENABLED] != "0",
            intervalMinutes = kv[Kv.INTERVAL_MIN]?.toIntOrNull() ?: 60,
            quietAfterDrinkMinutes = kv[Kv.QUIET_AFTER_DRINK_MIN]?.toIntOrNull() ?: 60,
            activeFrom = parseTime(kv[Kv.ACTIVE_FROM], LocalTime.of(8, 0)),
            activeTo = parseTime(kv[Kv.ACTIVE_TO], LocalTime.of(22, 0)),
            pauseWhenGoalMet = kv[Kv.PAUSE_WHEN_GOAL_MET] != "0",
        )
        return Settings(
            dailyGoalMl = kv[Kv.DAILY_GOAL_ML]?.toIntOrNull() ?: 2000,
            reminders = reminders,
            lastVolumeId = preset.volumeId,
            lastTypeId = preset.typeId,
        )
    }

    private fun parseTime(value: String?, fallback: LocalTime): LocalTime =
        try { if (value == null) fallback else LocalTime.parse(value) } catch (e: java.time.DateTimeException) { fallback }

    private fun readKv(db: SQLiteDatabase): Map<String, String> {
        val kv = HashMap<String, String>()
        db.rawQuery("SELECT key, value FROM kv", null).use { while (it.moveToNext()) kv[it.getString(0)] = it.getString(1) }
        return kv
    }

    private fun getKv(key: String): String? =
        helper.writableDatabase.rawQuery("SELECT value FROM kv WHERE key = ?", arrayOf(key)).use {
            if (it.moveToFirst()) it.getString(0) else null
        }

    private fun setKv(db: SQLiteDatabase, key: String, value: String) {
        db.execSQL("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", arrayOf<Any>(key, value))
    }

    private fun readTypes(db: SQLiteDatabase): List<DrinkType> {
        val types = ArrayList<DrinkType>()
        db.rawQuery("SELECT id, label, icon, position, archived, water_pct FROM drink_type ORDER BY position, id", null).use {
            while (it.moveToNext()) {
                types.add(DrinkType(it.getLong(0), it.getString(1), Json.icon(it.getString(2)), it.getInt(3), it.getInt(4) == 1, it.getInt(5)))
            }
        }
        return types
    }

    private fun readVolumes(db: SQLiteDatabase): List<Volume> {
        val volumes = ArrayList<Volume>()
        db.rawQuery("SELECT id, ml, label, icon, position FROM volume ORDER BY position, id", null).use {
            while (it.moveToNext()) volumes.add(Volume(it.getLong(0), it.getInt(1), it.getString(2), Json.icon(it.getString(3)), it.getInt(4)))
        }
        return volumes
    }

    private fun findType(db: SQLiteDatabase, id: Long): DrinkType? = readTypes(db).firstOrNull { it.id == id }

    private fun findVolume(db: SQLiteDatabase, id: Long): Volume? = readVolumes(db).firstOrNull { it.id == id }

    private fun insertLog(db: SQLiteDatabase, at: Instant, ml: Int, type: DrinkType): DrinkLog {
        val values = ContentValues().apply {
            put("at_ms", at.toEpochMilli()); put("ml", ml); put("type_id", type.id); put("water_pct", type.waterPct)
        }
        return DrinkLog(db.insertOrThrow("drink_log", null, values), at, ml, type.id, waterMlOf(ml, type.waterPct))
    }

    private fun setPosition(db: SQLiteDatabase, table: String, id: Long, position: Int) {
        db.execSQL("UPDATE $table SET position = ? WHERE id = ?", arrayOf<Any>(position, id))
    }

    private fun count(db: SQLiteDatabase, sql: String): Long = db.rawQuery(sql, null).use { it.moveToFirst(); it.getLong(0) }
}
