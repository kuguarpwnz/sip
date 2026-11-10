package app.sip.sketch.store

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import java.util.Calendar

class Db(context: Context) : SQLiteOpenHelper(context, "sip.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE drink_type (id INTEGER PRIMARY KEY, label TEXT NOT NULL, icon TEXT NOT NULL, " +
                "position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0)"
        )
        db.execSQL(
            "CREATE TABLE volume (id INTEGER PRIMARY KEY, ml INTEGER NOT NULL CHECK (ml > 0), " +
                "label TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL, position INTEGER NOT NULL)"
        )
        db.execSQL(
            "CREATE TABLE drink_log (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, " +
                "ml INTEGER NOT NULL CHECK (ml > 0), type_id INTEGER NOT NULL REFERENCES drink_type(id))"
        )
        db.execSQL("CREATE INDEX drink_log_at ON drink_log(at_ms)")
        db.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        seed(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    private fun seed(db: SQLiteDatabase) {
        listOf("droplet" to "Water", "coffee" to "Coffee", "teapot" to "Tea", "lemon-2" to "Juice", "milk" to "Milk")
            .forEachIndexed { i, (icon, label) ->
                db.insert("drink_type", null, ContentValues().apply {
                    put("id", i + 1); put("label", label); put("icon", icon); put("position", i)
                })
            }
        listOf(150 to "glass", 250 to "glass-full", 330 to "bottle", 500 to "bottle", 750 to "bucket-droplet")
            .forEachIndexed { i, (ml, icon) ->
                db.insert("volume", null, ContentValues().apply {
                    put("id", i + 1); put("ml", ml); put("icon", icon); put("position", i)
                })
            }
        mapOf(
            "daily_goal_ml" to "2000",
            "reminders_enabled" to "1",
            "interval_minutes" to "60",
            "active_from" to "08:00",
            "active_to" to "22:00",
            "pause_when_goal_met" to "1",
            "last_volume_id" to "2",
            "last_type_id" to "1",
        ).forEach { (k, v) ->
            db.insert("kv", null, ContentValues().apply { put("key", k); put("value", v) })
        }
        val now = System.currentTimeMillis()
        val midnight = startOfToday()
        listOf(Triple(40, 250, 1), Triple(100, 150, 2), Triple(170, 330, 3)).forEach { (minAgo, ml, type) ->
            db.insert("drink_log", null, ContentValues().apply {
                put("at_ms", maxOf(midnight, now - minAgo * 60_000L)); put("ml", ml); put("type_id", type)
            })
        }
    }

    fun snapshot(): JSObject {
        val db = readableDatabase
        val kv = HashMap<String, String>()
        db.rawQuery("SELECT key, value FROM kv", null).use { while (it.moveToNext()) kv[it.getString(0)] = it.getString(1) }

        val reminders = JSObject()
            .put("enabled", kv["reminders_enabled"] == "1")
            .put("intervalMinutes", kv["interval_minutes"]?.toInt())
            .put("activeFrom", kv["active_from"])
            .put("activeTo", kv["active_to"])
            .put("pauseWhenGoalMet", kv["pause_when_goal_met"] == "1")
        val settings = JSObject()
            .put("dailyGoalMl", kv["daily_goal_ml"]?.toInt())
            .put("reminders", reminders)
            .put("lastVolumeId", kv["last_volume_id"]?.toLong())
            .put("lastTypeId", kv["last_type_id"]?.toLong())

        val types = JSArray()
        db.rawQuery("SELECT id, label, icon, position, archived FROM drink_type ORDER BY position", null).use {
            while (it.moveToNext()) types.put(
                JSObject().put("id", it.getLong(0)).put("label", it.getString(1)).put("icon", it.getString(2))
                    .put("position", it.getInt(3)).put("archived", it.getInt(4) == 1)
            )
        }
        val volumes = JSArray()
        db.rawQuery("SELECT id, ml, label, icon, position FROM volume ORDER BY position", null).use {
            while (it.moveToNext()) volumes.put(
                JSObject().put("id", it.getLong(0)).put("ml", it.getInt(1)).put("label", it.getString(2))
                    .put("icon", it.getString(3)).put("position", it.getInt(4))
            )
        }
        val logs = JSArray()
        db.rawQuery(
            "SELECT id, at_ms, ml, type_id FROM drink_log WHERE at_ms >= ? ORDER BY at_ms DESC",
            arrayOf(startOfToday().toString())
        ).use {
            while (it.moveToNext()) logs.put(
                JSObject().put("id", it.getLong(0)).put("atMs", it.getLong(1)).put("ml", it.getInt(2))
                    .put("typeId", it.getLong(3))
            )
        }
        return JSObject().put("settings", settings).put("types", types).put("volumes", volumes).put("todayLogs", logs)
    }

    private fun startOfToday(): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis
}
