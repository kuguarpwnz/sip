package app.sip.core.domain

import java.time.Instant
import java.time.LocalTime

@JvmInline
value class AppIcon(val key: String) {
    companion object {
        val DROPLET = AppIcon("droplet")
    }
}

data class DrinkType(val id: Long, val label: String, val icon: AppIcon, val position: Int, val archived: Boolean, val waterPct: Int)

data class Volume(val id: Long, val ml: Int, val label: String, val icon: AppIcon, val position: Int)

/** `waterMl` is `ml` scaled by the drink type's current water content. It is computed on read and never stored. */
data class DrinkLog(val id: Long, val at: Instant, val ml: Int, val typeId: Long, val waterMl: Int)

fun waterMlOf(ml: Int, waterPct: Int): Int = (ml * waterPct + 50) / 100

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
    val newestLog: DrinkLog?,
    val preset: Preset,
) {
    val todayMl: Int get() = todayLogs.sumOf { it.waterMl }
    val lastDrinkAt: Instant? get() = newestLog?.at
}

data class ReminderStatus(
    val notificationsAllowed: Boolean,
    val channelEnabled: Boolean,
    val exactAlarmsAllowed: Boolean,
    val batteryUnrestricted: Boolean,
    val nextReminderAt: Instant?,
    val missedReminderAt: Instant?,
)

data class Logged(val log: DrinkLog, val type: DrinkType, val snapshot: Snapshot)

data class LogInput(val id: Long?, val at: Instant, val ml: Int, val typeId: Long)
data class VolumeInput(val id: Long?, val ml: Int, val label: String, val icon: AppIcon)
data class TypeInput(val id: Long?, val label: String, val icon: AppIcon, val waterPct: Int)

data class ReminderPatch(
    val enabled: Boolean? = null,
    val intervalMinutes: Int? = null,
    val quietAfterDrinkMinutes: Int? = null,
    val activeFrom: LocalTime? = null,
    val activeTo: LocalTime? = null,
    val pauseWhenGoalMet: Boolean? = null,
)

data class SettingsPatch(val dailyGoalMl: Int? = null, val reminders: ReminderPatch? = null)

/** A message safe to show the user. Thrown for bad input and broken rules, never for bugs. */
class Rejected(message: String) : Exception(message)
