package app.sip.core.domain

import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReminderPlannerTest {
    private val stockholm = ZoneId.of("Europe/Stockholm")
    private val kyiv = ZoneId.of("Europe/Kyiv")

    private fun at(local: String, zone: ZoneId = stockholm): Instant =
        LocalDateTime.parse(local).atZone(zone).toInstant()

    private fun settings(
        enabled: Boolean = true,
        interval: Int = 30,
        quiet: Int = 30,
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
        zone: ZoneId = stockholm,
    ): Instant? {
        val nowInstant = at(now, zone)
        return ReminderPlanner.next(
            now = nowInstant,
            zone = zone,
            settings = settings,
            goalMl = goalMl,
            todayMl = todayMl,
            today = nowInstant.atZone(zone).toLocalDate(),
            lastDrinkAt = lastDrink?.let { at(it, zone) },
        )
    }

    @Test
    fun noDrinkGivesTheNextSlot() {
        assertEquals(at("2026-06-10T09:30"), next("2026-06-10T09:10"))
    }

    @Test
    fun drinkSkipsASlotInsideTheQuietWindow() {
        val result = next("2026-06-10T09:24", settings(quiet = 30), lastDrink = "2026-06-10T09:23")
        assertEquals(at("2026-06-10T10:00"), result)
    }

    @Test
    fun drinkSkipsSlotsButKeepsTheGrid() {
        val result = next("2026-06-10T09:24", settings(quiet = 60), lastDrink = "2026-06-10T09:23")
        assertEquals(at("2026-06-10T10:30"), result)
    }

    @Test
    fun zeroQuietNeverSkipsASlot() {
        val result = next("2026-06-10T09:24", settings(quiet = 0), lastDrink = "2026-06-10T09:23")
        assertEquals(at("2026-06-10T09:30"), result)
    }

    @Test
    fun slotExactlyAtTheQuietBoundaryFires() {
        val result = next("2026-06-10T09:05", settings(quiet = 30), lastDrink = "2026-06-10T09:00")
        assertEquals(at("2026-06-10T09:30"), result)
    }

    @Test
    fun alarmFiringOnItsSlotMovesToTheNextSlot() {
        assertEquals(at("2026-06-10T10:30"), next("2026-06-10T10:00:00"))
    }

    @Test
    fun alarmFiringJustAfterItsSlotMovesToTheNextSlot() {
        assertEquals(at("2026-06-10T10:30"), next("2026-06-10T10:00:00.005"))
    }

    @Test
    fun gridStartsAtActiveFromWithTheConfiguredInterval() {
        assertEquals(at("2026-06-10T11:00"), next("2026-06-10T10:00", settings(interval = 90)))
    }

    @Test
    fun afterTheLastSlotMovesToTomorrowsActiveFrom() {
        assertEquals(at("2026-06-11T08:00"), next("2026-06-10T22:10", settings(interval = 60)))
    }

    @Test
    fun slotEqualToActiveToCounts() {
        assertEquals(at("2026-06-10T22:00"), next("2026-06-10T21:30", settings(interval = 60)))
    }

    @Test
    fun lastSlotOfTheDayStaysBeforeActiveTo() {
        assertEquals(at("2026-06-11T08:00"), next("2026-06-10T21:40", settings(interval = 90)))
    }

    @Test
    fun beforeActiveFromWaitsForActiveFrom() {
        assertEquals(at("2026-06-10T08:00"), next("2026-06-10T06:00", settings(interval = 60)))
    }

    @Test
    fun goalMetPausesTodayAndResumesTomorrow() {
        assertEquals(at("2026-06-11T08:00"), next("2026-06-10T12:00", todayMl = 2000))
        assertEquals(at("2026-06-10T12:30"), next("2026-06-10T12:00", todayMl = 1999))
    }

    @Test
    fun goalMetKeepsRemindingWhenPauseIsOff() {
        assertEquals(at("2026-06-10T12:30"), next("2026-06-10T12:00", settings(pause = false), todayMl = 3000))
    }

    @Test
    fun drinkBeforeActiveFromSkipsTheFirstSlot() {
        val result = next("2026-06-10T07:55", lastDrink = "2026-06-10T07:50")
        assertEquals(at("2026-06-10T08:30"), result)
    }

    @Test
    fun disabledReturnsNull() {
        assertNull(next("2026-06-10T10:00", settings(enabled = false)))
    }

    @Test
    fun springForwardKeepsTheGridOnWallClockTimes() {
        val result = next("2026-03-29T08:20", settings(interval = 60), zone = kyiv)
        assertEquals(at("2026-03-29T09:00", kyiv), result)
        assertEquals(Instant.parse("2026-03-29T06:00:00Z"), result)
    }

    @Test
    fun fallBackKeepsTheGridOnWallClockTimes() {
        val result = next("2026-10-25T08:20", settings(interval = 60), zone = kyiv)
        assertEquals(at("2026-10-25T09:00", kyiv), result)
        assertEquals(Instant.parse("2026-10-25T07:00:00Z"), result)
    }

    @Test
    fun quietWindowSpillingPastTomorrowSkipsAllOfTomorrowsSlots() {
        val overnight = settings(interval = 15, quiet = 240, from = "00:00", to = "00:30")
        val result = next("2026-06-10T23:59:30", overnight, lastDrink = "2026-06-10T23:59")
        assertEquals(at("2026-06-12T00:00"), result)
    }

    @Test
    fun repeatedCallsReturnTheSameSlot() {
        val s = settings(quiet = 60)
        val first = next("2026-06-10T09:31", s, lastDrink = "2026-06-10T09:23")
        val later = next("2026-06-10T09:45", s, lastDrink = "2026-06-10T09:23")
        assertEquals(at("2026-06-10T10:30"), first)
        assertEquals(first, later)
    }
}
