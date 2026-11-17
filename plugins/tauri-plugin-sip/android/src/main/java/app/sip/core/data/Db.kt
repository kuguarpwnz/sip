package app.sip.core.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

object Kv {
    const val DAILY_GOAL_ML = "daily_goal_ml"
    const val REMINDERS_ENABLED = "reminders_enabled"
    const val INTERVAL_MIN = "interval_minutes"
    const val QUIET_AFTER_DRINK_MIN = "quiet_after_drink_min"
    const val ACTIVE_FROM = "active_from"
    const val ACTIVE_TO = "active_to"
    const val PAUSE_WHEN_GOAL_MET = "pause_when_goal_met"
    const val SCHEDULED_FOR_MS = "scheduled_for_ms"
    const val LAST_FIRED_MS = "last_fired_ms"
    const val MISSED_REMINDER_MS = "missed_reminder_ms"
}

class Db(context: Context) : SQLiteOpenHelper(context, "sip.db", null, 2) {
    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE drink_type (id INTEGER PRIMARY KEY, label TEXT NOT NULL, icon TEXT NOT NULL, " +
                "position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0, " +
                "water_pct INTEGER NOT NULL DEFAULT 100 CHECK (water_pct BETWEEN 0 AND 100))"
        )
        db.execSQL(
            "CREATE TABLE volume (id INTEGER PRIMARY KEY, ml INTEGER NOT NULL CHECK (ml > 0), " +
                "label TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL, position INTEGER NOT NULL)"
        )
        db.execSQL(
            "CREATE TABLE drink_log (id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, " +
                "ml INTEGER NOT NULL CHECK (ml > 0), type_id INTEGER NOT NULL REFERENCES drink_type(id), " +
                "water_pct INTEGER NOT NULL DEFAULT 100 CHECK (water_pct BETWEEN 0 AND 100))"
        )
        db.execSQL("CREATE INDEX drink_log_at ON drink_log(at_ms)")
        db.execSQL("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        seed(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL(
                "ALTER TABLE drink_type ADD COLUMN water_pct INTEGER NOT NULL DEFAULT 100 " +
                    "CHECK (water_pct BETWEEN 0 AND 100)"
            )
            db.execSQL(
                "ALTER TABLE drink_log ADD COLUMN water_pct INTEGER NOT NULL DEFAULT 100 " +
                    "CHECK (water_pct BETWEEN 0 AND 100)"
            )
            db.execSQL("DELETE FROM kv WHERE key IN ('last_volume_id', 'last_type_id')")
        }
    }

    private fun seed(db: SQLiteDatabase) {
        listOf(
            Triple("droplet", "Water", 100),
            Triple("coffee", "Coffee", 99),
            Triple("teapot", "Tea", 99),
            Triple("lemon-2", "Juice", 88),
            Triple("milk", "Milk", 88),
        ).forEachIndexed { i, (icon, label, waterPct) ->
                db.insertOrThrow("drink_type", null, ContentValues().apply {
                    put("id", i + 1); put("label", label); put("icon", icon); put("position", i); put("water_pct", waterPct)
                })
            }
        listOf(150 to "cup", 250 to "glass-full", 330 to "glass", 500 to "bottle", 750 to "bucket-droplet")
            .forEachIndexed { i, (ml, icon) ->
                db.insertOrThrow("volume", null, ContentValues().apply {
                    put("id", i + 1); put("ml", ml); put("icon", icon); put("position", i)
                })
            }
        mapOf(
            Kv.DAILY_GOAL_ML to "2000",
            Kv.REMINDERS_ENABLED to "1",
            Kv.INTERVAL_MIN to "60",
            Kv.QUIET_AFTER_DRINK_MIN to "60",
            Kv.ACTIVE_FROM to "08:00",
            Kv.ACTIVE_TO to "22:00",
            Kv.PAUSE_WHEN_GOAL_MET to "1",
        ).forEach { (k, v) ->
            db.insertOrThrow("kv", null, ContentValues().apply { put("key", k); put("value", v) })
        }
    }
}
