package app.sip.core.domain

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

object ReminderPlanner {
    private const val DAYS_SEARCHED = 3

    /**
     * Reminders sit on a wall-clock grid: `activeFrom + k * interval` while `<= activeTo`, every day.
     * A drink skips the slots inside its quiet window and never moves the grid.
     * `todayMl` counts for `today` only. Slots on later days start that day at zero.
     */
    fun next(
        now: Instant,
        zone: ZoneId,
        settings: ReminderSettings,
        goalMl: Int,
        todayMl: Int,
        today: LocalDate,
        lastDrinkAt: Instant?,
    ): Instant? {
        if (!settings.enabled) return null

        val quietEnd = lastDrinkAt?.plus(Duration.ofMinutes(settings.quietAfterDrinkMinutes.toLong()))
        val times = slotTimes(settings)
        for (offset in 0 until DAYS_SEARCHED) {
            val day = today.plusDays(offset.toLong())
            if (offset == 0 && settings.pauseWhenGoalMet && todayMl >= goalMl) continue
            for (time in times) {
                val slot = ZonedDateTime.of(day, time, zone).toInstant()
                if (!slot.isAfter(now)) continue
                if (quietEnd != null && slot.isBefore(quietEnd)) continue
                return slot
            }
        }
        return null
    }

    private fun slotTimes(settings: ReminderSettings): List<LocalTime> {
        val step = settings.intervalMinutes.toLong()
        val times = ArrayList<LocalTime>()
        var time = settings.activeFrom
        while (!time.isAfter(settings.activeTo)) {
            times += time
            val following = time.plusMinutes(step)
            if (!following.isAfter(time)) break
            time = following
        }
        return times
    }
}
