package app.sip.core.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

object ReminderPlanner {
    private val RETRY_AFTER_MISS = Duration.ofMinutes(1)

    /** `todayMl` counts for `today` only. A candidate on a later day starts that day at zero. */
    fun next(
        now: Instant,
        zone: ZoneId,
        settings: ReminderSettings,
        goalMl: Int,
        todayMl: Int,
        today: LocalDate,
        lastDrinkAt: Instant?,
        lastReminderAt: Instant?,
        clockStart: Instant,
    ): Instant? {
        if (!settings.enabled) return null

        val afterReminder = lastReminderAt?.plus(Duration.ofMinutes(settings.intervalMinutes.toLong()))
        val afterDrink = lastDrinkAt?.plus(Duration.ofMinutes(settings.quietAfterDrinkMinutes.toLong()))
        var candidate = listOfNotNull(afterReminder, afterDrink).maxOrNull()
            ?: clockStart.plus(Duration.ofMinutes(settings.intervalMinutes.toLong()))

        if (candidate.isBefore(now)) candidate = now.plus(RETRY_AFTER_MISS)

        val local = candidate.atZone(zone)
        val day = local.toLocalDate()
        val time = local.toLocalTime()
        if (time.isBefore(settings.activeFrom)) {
            candidate = activeFrom(day, settings, zone)
        } else if (time.isAfter(settings.activeTo)) {
            candidate = activeFrom(day.plusDays(1), settings, zone)
        }

        val candidateDay = candidate.atZone(zone).toLocalDate()
        val goalMet = settings.pauseWhenGoalMet && candidateDay == today && todayMl >= goalMl
        if (goalMet) candidate = activeFrom(candidateDay.plusDays(1), settings, zone)

        return candidate
    }

    private fun activeFrom(day: LocalDate, settings: ReminderSettings, zone: ZoneId): Instant =
        ZonedDateTime.of(day, settings.activeFrom, zone).toInstant()
}
