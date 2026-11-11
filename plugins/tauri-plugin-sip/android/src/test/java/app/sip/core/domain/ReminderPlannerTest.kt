package app.sip.core.domain

import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReminderPlannerTest {
    private val zone = ZoneId.of("Europe/Stockholm")

    private fun at(local: String): Instant = LocalDateTime.parse(local).atZone(zone).toInstant()

    private fun settings(
        enabled: Boolean = true,
        interval: Int = 60,
        quiet: Int = 60,
        from: String = "08:00",
        to: String = "22:00",
        pause: Boolean = true,
    ) = ReminderSettings(enabled, interval, quiet, LocalTime.parse(from), LocalTime.parse(to), pause)

    private fun next(
        now: String,
        settings: ReminderSettings = settings(),
        todayMl: Int = 0,
        goalMl: Int = 2000,
        lastDrink: String? = null,
        lastReminder: String? = null,
        clockStart: String = now,
    ): Instant? {
        val nowInstant = at(now)
        return ReminderPlanner.next(
            now = nowInstant,
            zone = zone,
            settings = settings,
            goalMl = goalMl,
            todayMl = todayMl,
            today = nowInstant.atZone(zone).toLocalDate(),
            lastDrinkAt = lastDrink?.let(::at),
            lastReminderAt = lastReminder?.let(::at),
            clockStart = at(clockStart),
        )
    }

    @Test
    fun disabledReturnsNull() {
        assertNull(next("2026-06-10T10:00", settings(enabled = false)))
    }

    @Test
    fun bothTimesMissingWaitsOneInterval() {
        assertEquals(at("2026-06-10T11:00"), next("2026-06-10T10:00"))
        assertEquals(at("2026-06-10T11:30"), next("2026-06-10T10:00", settings(interval = 90)))
    }

    @Test
    fun noHistoryReturnsTheSameInstantAtDifferentNows() {
        val first = next("2026-06-10T10:00", clockStart = "2026-06-10T09:30")
        val later = next("2026-06-10T10:10", clockStart = "2026-06-10T09:30")
        assertEquals(at("2026-06-10T10:30"), first)
        assertEquals(first, later)
    }

    @Test
    fun noHistoryWithAnOldAnchorFiresInOneMinute() {
        assertEquals(at("2026-06-10T10:01"), next("2026-06-10T10:00", clockStart = "2026-06-01T09:00"))
    }

    @Test
    fun anchorIsIgnoredOnceAReminderOrDrinkExists() {
        val old = "2026-06-01T09:00"
        assertEquals(at("2026-06-10T10:30"), next("2026-06-10T10:00", lastReminder = "2026-06-10T09:30", clockStart = old))
        assertEquals(at("2026-06-10T10:40"), next("2026-06-10T10:00", lastDrink = "2026-06-10T09:40", clockStart = old))
    }

    @Test
    fun quietWindowHoldsAReminderBack() {
        val result = next("2026-06-10T10:00", lastReminder = "2026-06-10T09:00", lastDrink = "2026-06-10T09:50")
        assertEquals(at("2026-06-10T10:50"), result)
    }

    @Test
    fun intervalWinsWhenTheDrinkIsOlder() {
        val result = next("2026-06-10T10:00", lastReminder = "2026-06-10T09:30", lastDrink = "2026-06-10T08:45")
        assertEquals(at("2026-06-10T10:30"), result)
    }

    @Test
    fun onlyADrinkStartsTheQuietWindow() {
        assertEquals(at("2026-06-10T10:40"), next("2026-06-10T10:00", lastDrink = "2026-06-10T09:40"))
    }

    @Test
    fun zeroQuietMinutesIgnoresDrinks() {
        val result = next("2026-06-10T10:00", settings(quiet = 0), lastReminder = "2026-06-10T09:30", lastDrink = "2026-06-10T09:55")
        assertEquals(at("2026-06-10T10:30"), result)
    }

    @Test
    fun pastCandidateBecomesNowPlusOneMinute() {
        assertEquals(at("2026-06-10T10:01"), next("2026-06-10T10:00", lastReminder = "2026-06-10T07:00"))
    }

    @Test
    fun candidateBeforeTheWindowMovesToActiveFrom() {
        assertEquals(at("2026-06-10T08:00"), next("2026-06-10T04:30"))
    }

    @Test
    fun candidateAfterTheWindowMovesToTomorrowsActiveFrom() {
        assertEquals(at("2026-06-11T08:00"), next("2026-06-10T22:30"))
        assertEquals(at("2026-06-11T08:00"), next("2026-06-10T21:30"))
    }

    @Test
    fun candidateAtActiveToStaysInTheWindow() {
        assertEquals(at("2026-06-10T22:00"), next("2026-06-10T21:00"))
    }

    @Test
    fun goalMetPausesUntilTomorrow() {
        assertEquals(at("2026-06-11T08:00"), next("2026-06-10T14:00", todayMl = 2000))
        assertEquals(at("2026-06-10T15:00"), next("2026-06-10T14:00", todayMl = 1999))
    }

    @Test
    fun goalMetKeepsRemindingWhenPauseIsOff() {
        assertEquals(at("2026-06-10T15:00"), next("2026-06-10T14:00", settings(pause = false), todayMl = 3000))
    }

    @Test
    fun aCandidateTomorrowIgnoresTodaysGoal() {
        val allDay = settings(from = "00:00", to = "23:59", quiet = 240)
        val result = next("2026-06-10T22:30", allDay, todayMl = 2500, lastDrink = "2026-06-10T22:30")
        assertEquals(at("2026-06-11T02:30"), result)
    }

    @Test
    fun springForwardDayStartsAtEightLocalTime() {
        val result = next("2026-03-28T22:30")
        assertEquals(Instant.parse("2026-03-29T06:00:00Z"), result)
    }

    @Test
    fun fallBackDayStartsAtEightLocalTime() {
        val result = next("2026-10-24T22:30")
        assertEquals(Instant.parse("2026-10-25T07:00:00Z"), result)
    }

    @Test
    fun activeFromInsideTheSpringGapShiftsForward() {
        val gap = settings(from = "02:30", to = "22:00")
        val result = next("2026-03-28T22:30", gap)
        assertEquals(Instant.parse("2026-03-29T01:30:00Z"), result)
    }
}
