package app.sip.core.data

import app.sip.core.domain.AppIcon
import app.sip.core.domain.DrinkLog
import app.sip.core.domain.LogInput
import app.sip.core.domain.LogRange
import app.sip.core.domain.ReminderPatch
import app.sip.core.domain.ReminderSettings
import app.sip.core.domain.ReminderStatus
import app.sip.core.domain.Rejected
import app.sip.core.domain.SettingsPatch
import app.sip.core.domain.Snapshot
import app.sip.core.domain.TypeInput
import app.sip.core.domain.VolumeInput
import java.time.Instant
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/** The plugin boundary. Everything the WebView sends is checked here, everything it receives is built here. */
object Json {
    val SETTINGS_TARGETS = setOf("notifications", "exactAlarms", "battery", "app")

    private val HHMM = DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)
    private val HHMM_PATTERN = Regex("""([01]\d|2[0-3]):[0-5]\d""")

    fun formatTime(time: LocalTime): String = time.format(HHMM)

    fun icon(key: String): AppIcon = if (key in IconKeys.ALL) AppIcon(key) else AppIcon.DROPLET

    fun snapshot(s: Snapshot): JSONObject {
        val r = s.settings.reminders
        return JSONObject()
            .put("settings", JSONObject()
                .put("dailyGoalMl", s.settings.dailyGoalMl)
                .put("reminders", reminders(r))
                .put("lastVolumeId", orNull(s.settings.lastVolumeId))
                .put("lastTypeId", orNull(s.settings.lastTypeId)))
            .put("types", JSONArray(s.types.map {
                JSONObject().put("id", it.id).put("label", it.label).put("icon", it.icon.key)
                    .put("position", it.position).put("archived", it.archived).put("waterPct", it.waterPct)
            }))
            .put("volumes", JSONArray(s.volumes.map {
                JSONObject().put("id", it.id).put("ml", it.ml).put("label", it.label)
                    .put("icon", it.icon.key).put("position", it.position)
            }))
            .put("todayLogs", JSONArray(s.todayLogs.map(::log)))
            .put("dayStartMs", s.dayStart.toEpochMilli())
            .put("lastDrinkAtMs", orNull(s.lastDrinkAt?.toEpochMilli()))
    }

    fun status(s: ReminderStatus): JSONObject = JSONObject()
        .put("notificationsAllowed", s.notificationsAllowed)
        .put("channelEnabled", s.channelEnabled)
        .put("exactAlarmsAllowed", s.exactAlarmsAllowed)
        .put("batteryUnrestricted", s.batteryUnrestricted)
        .put("nextReminderAtMs", orNull(s.nextReminderAt?.toEpochMilli()))
        .put("missedReminderAtMs", orNull(s.missedReminderAt?.toEpochMilli()))

    private fun reminders(r: ReminderSettings) = JSONObject()
        .put("enabled", r.enabled)
        .put("intervalMin", r.intervalMinutes)
        .put("quietAfterDrinkMin", r.quietAfterDrinkMinutes)
        .put("activeFrom", formatTime(r.activeFrom))
        .put("activeTo", formatTime(r.activeTo))
        .put("pauseWhenGoalMet", r.pauseWhenGoalMet)

    fun logRange(r: LogRange): JSONObject = JSONObject()
        .put("logs", JSONArray(r.logs.map(::log)))
        .put("firstAtMs", orNull(r.firstAt?.toEpochMilli()))

    private fun log(l: DrinkLog) = JSONObject()
        .put("id", l.id).put("atMs", l.at.toEpochMilli()).put("ml", l.ml).put("typeId", l.typeId).put("waterMl", l.waterMl)

    private fun orNull(value: Any?): Any = value ?: JSONObject.NULL

    fun parseLogDrink(args: JSONObject): Pair<Long, Long> = long(args, "volumeId") to long(args, "typeId")

    fun parseRange(args: JSONObject): Pair<Instant, Instant> {
        val from = long(args, "fromMs")
        val to = long(args, "toMs")
        if (from >= to) throw Rejected("fromMs must be before toMs")
        return Instant.ofEpochMilli(from) to Instant.ofEpochMilli(to)
    }

    fun parseId(args: JSONObject): Long = long(args, "id")

    fun parseNewLog(args: JSONObject): LogInput = LogInput(null, time(args), ml(args), long(args, "typeId"))

    fun parseLogUpdate(args: JSONObject): LogInput = LogInput(long(args, "id"), time(args), ml(args), long(args, "typeId"))

    fun parseVolume(args: JSONObject): VolumeInput {
        val label = args.optString("label", "").trim()
        if (label.length > 24) throw Rejected("Label can be at most 24 characters")
        return VolumeInput(optionalLong(args, "id"), ml(args), label, iconKey(args))
    }

    fun parseType(args: JSONObject): TypeInput {
        val label = string(args, "label").trim()
        if (label.isEmpty() || label.length > 24) throw Rejected("Label must be 1 to 24 characters")
        return TypeInput(optionalLong(args, "id"), label, iconKey(args), waterPct(args))
    }

    fun parseIds(args: JSONObject): List<Long> {
        val array = args.optJSONArray("ids") ?: throw Rejected("ids must be a list")
        val ids = (0 until array.length()).map { integral(array.opt(it), "ids") }
        if (ids.isEmpty() || ids.toSet().size != ids.size) throw Rejected("ids must be a non-empty list without repeats")
        return ids
    }

    fun parseSettings(args: JSONObject): SettingsPatch {
        val goal = optionalInt(args, "dailyGoalMl")?.also {
            if (it !in 500..6000) throw Rejected("Daily goal must be 500 to 6000 ml")
        }
        val reminders = args.optJSONObject("reminders")?.let(::parseReminderPatch)
        return SettingsPatch(goal, reminders)
    }

    fun parseSettingsTarget(args: JSONObject): String {
        val target = string(args, "target")
        if (target !in SETTINGS_TARGETS) throw Rejected("Unknown settings target")
        return target
    }

    private fun parseReminderPatch(r: JSONObject) = ReminderPatch(
        enabled = optionalBool(r, "enabled"),
        intervalMinutes = optionalInt(r, "intervalMin")?.also {
            if (it !in 15..240) throw Rejected("Reminder interval must be 15 to 240 minutes")
        },
        quietAfterDrinkMinutes = optionalInt(r, "quietAfterDrinkMin")?.also {
            if (it !in 0..240) throw Rejected("Quiet time after a drink must be 0 to 240 minutes")
        },
        activeFrom = optionalTime(r, "activeFrom"),
        activeTo = optionalTime(r, "activeTo"),
        pauseWhenGoalMet = optionalBool(r, "pauseWhenGoalMet"),
    )

    private fun time(args: JSONObject): Instant {
        val ms = long(args, "atMs")
        if (ms <= 0) throw Rejected("Time is not valid")
        return Instant.ofEpochMilli(ms)
    }

    private fun ml(args: JSONObject): Int {
        val ml = int(args, "ml")
        if (ml !in 10..3000) throw Rejected("Amount must be 10 to 3000 ml")
        return ml
    }

    private fun waterPct(args: JSONObject): Int {
        val pct = int(args, "waterPct")
        if (pct !in 0..100) throw Rejected("Water content must be between 0 and 100%")
        return pct
    }

    private fun iconKey(args: JSONObject): AppIcon {
        val key = string(args, "icon")
        if (key !in IconKeys.ALL) throw Rejected("Unknown icon: $key")
        return AppIcon(key)
    }

    private fun present(args: JSONObject, name: String): Any? = args.opt(name).takeUnless { it == null || it == JSONObject.NULL }

    private fun integral(value: Any?, name: String): Long {
        if (value !is Number) throw Rejected("$name must be a whole number")
        val d = value.toDouble()
        if (d != Math.rint(d) || d.isInfinite()) throw Rejected("$name must be a whole number")
        return value.toLong()
    }

    private fun long(args: JSONObject, name: String): Long = integral(present(args, name) ?: throw Rejected("Missing $name"), name)

    private fun int(args: JSONObject, name: String): Int {
        val v = long(args, name)
        if (v !in Int.MIN_VALUE..Int.MAX_VALUE) throw Rejected("$name is out of range")
        return v.toInt()
    }

    private fun optionalLong(args: JSONObject, name: String): Long? = present(args, name)?.let { integral(it, name) }

    private fun optionalInt(args: JSONObject, name: String): Int? = if (present(args, name) == null) null else int(args, name)

    private fun string(args: JSONObject, name: String): String =
        present(args, name) as? String ?: throw Rejected("Missing $name")

    private fun optionalBool(args: JSONObject, name: String): Boolean? = present(args, name)?.let {
        it as? Boolean ?: throw Rejected("$name must be true or false")
    }

    private fun optionalTime(args: JSONObject, name: String): LocalTime? = present(args, name)?.let {
        val text = it as? String
        if (text == null || !HHMM_PATTERN.matches(text)) throw Rejected("$name must look like 08:00")
        LocalTime.parse(text)
    }
}
