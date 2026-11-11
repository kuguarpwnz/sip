package app.sip.core.data

import android.content.Context
import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import app.sip.core.domain.DrinkLog
import app.sip.core.domain.DrinkType
import app.sip.core.domain.LogInput
import app.sip.core.domain.Logged
import app.sip.core.domain.ReminderPlanner
import app.sip.core.domain.ReminderSettings
import app.sip.core.domain.Rejected
import app.sip.core.domain.Settings
import app.sip.core.domain.SettingsPatch
import app.sip.core.domain.Snapshot
import app.sip.core.domain.TypeInput
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
        val log = insertLog(db, at, volume.ml, type.id)
        setKv(db, Kv.LAST_VOLUME_ID, volume.id.toString())
        setKv(db, Kv.LAST_TYPE_ID, type.id.toString())
        Logged(log, type, readSnapshot(db, at))
    }

    /** What the notification button logs: the last used volume and type, or the first of each. */
    @Synchronized
    fun logPreselected(at: Instant = Instant.now()): Logged {
        val s = snapshot(at)
        val volumeId = s.settings.lastVolumeId ?: throw Rejected("No volume")
        val typeId = s.settings.lastTypeId ?: throw Rejected("No drink type")
        return logDrink(volumeId, typeId, at)
    }

    @Synchronized
    fun addLog(input: LogInput): Snapshot = tx { db ->
        findType(db, input.typeId) ?: throw Rejected("Drink type not found")
        insertLog(db, input.at, input.ml, input.typeId)
        readSnapshot(db)
    }

    @Synchronized
    fun updateLog(input: LogInput): Snapshot = tx { db ->
        findType(db, input.typeId) ?: throw Rejected("Drink type not found")
        val id = input.id ?: throw Rejected("Missing id")
        val values = ContentValues().apply {
            put("at_ms", input.at.toEpochMilli()); put("ml", input.ml); put("type_id", input.typeId)
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
                "INSERT INTO drink_type (label, icon, position) " +
                    "VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM drink_type))",
                arrayOf<Any>(input.label, input.icon.key),
            )
        } else {
            val values = ContentValues().apply { put("label", input.label); put("icon", input.icon.key) }
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
        val current = readSettings(readKv(db), readVolumes(db), readTypes(db))
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
            lastReminderAt = lastReminderAt(),
            clockStart = clockStart(now),
        )
    }

    /** Databases created before the anchor existed lack the key. The first call persists `now` and later calls keep it. */
    private fun clockStart(now: Instant): Instant = tx { db ->
        db.execSQL(
            "INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)",
            arrayOf<Any>(Kv.CLOCK_START_MS, now.toEpochMilli().toString()),
        )
        db.rawQuery("SELECT value FROM kv WHERE key = ?", arrayOf(Kv.CLOCK_START_MS)).use {
            it.moveToFirst()
            Instant.ofEpochMilli(it.getString(0).toLong())
        }
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
            "SELECT id, at_ms, ml, type_id FROM drink_log WHERE at_ms >= ? AND at_ms < ? ORDER BY at_ms DESC, id DESC",
            arrayOf(dayStart.toEpochMilli().toString(), dayEnd.toEpochMilli().toString()),
        ).use {
            while (it.moveToNext()) logs.add(DrinkLog(it.getLong(0), Instant.ofEpochMilli(it.getLong(1)), it.getInt(2), it.getLong(3)))
        }
        val lastDrink = db.rawQuery("SELECT MAX(at_ms) FROM drink_log", null).use {
            if (it.moveToFirst() && !it.isNull(0)) Instant.ofEpochMilli(it.getLong(0)) else null
        }
        return Snapshot(readSettings(readKv(db), volumes, types), types, volumes, logs, dayStart, lastDrink)
    }

    private fun readSettings(kv: Map<String, String>, volumes: List<Volume>, types: List<DrinkType>): Settings {
        val reminders = ReminderSettings(
            enabled = kv[Kv.REMINDERS_ENABLED] != "0",
            intervalMinutes = kv[Kv.INTERVAL_MIN]?.toIntOrNull() ?: 60,
            quietAfterDrinkMinutes = kv[Kv.QUIET_AFTER_DRINK_MIN]?.toIntOrNull() ?: 60,
            activeFrom = parseTime(kv[Kv.ACTIVE_FROM], LocalTime.of(8, 0)),
            activeTo = parseTime(kv[Kv.ACTIVE_TO], LocalTime.of(22, 0)),
            pauseWhenGoalMet = kv[Kv.PAUSE_WHEN_GOAL_MET] != "0",
        )
        val lastVolume = kv[Kv.LAST_VOLUME_ID]?.toLongOrNull()
        val lastType = kv[Kv.LAST_TYPE_ID]?.toLongOrNull()
        return Settings(
            dailyGoalMl = kv[Kv.DAILY_GOAL_ML]?.toIntOrNull() ?: 2000,
            reminders = reminders,
            lastVolumeId = (volumes.firstOrNull { it.id == lastVolume } ?: volumes.firstOrNull())?.id,
            lastTypeId = (types.firstOrNull { it.id == lastType && !it.archived } ?: types.firstOrNull { !it.archived })?.id,
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
        db.rawQuery("SELECT id, label, icon, position, archived FROM drink_type ORDER BY position, id", null).use {
            while (it.moveToNext()) types.add(DrinkType(it.getLong(0), it.getString(1), Json.icon(it.getString(2)), it.getInt(3), it.getInt(4) == 1))
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

    private fun insertLog(db: SQLiteDatabase, at: Instant, ml: Int, typeId: Long): DrinkLog {
        val values = ContentValues().apply {
            put("at_ms", at.toEpochMilli()); put("ml", ml); put("type_id", typeId)
        }
        return DrinkLog(db.insertOrThrow("drink_log", null, values), at, ml, typeId)
    }

    private fun setPosition(db: SQLiteDatabase, table: String, id: Long, position: Int) {
        db.execSQL("UPDATE $table SET position = ? WHERE id = ?", arrayOf<Any>(position, id))
    }

    private fun count(db: SQLiteDatabase, sql: String): Long = db.rawQuery(sql, null).use { it.moveToFirst(); it.getLong(0) }
}
