package app.sip.core.domain

import java.time.Instant
import java.time.LocalTime
import org.junit.Assert.assertEquals
import org.junit.Test

class WaterTest {
    @Test
    fun fullWaterKeepsTheAmountAndZeroDropsIt() {
        assertEquals(250, waterMlOf(250, 100))
        assertEquals(0, waterMlOf(250, 0))
    }

    @Test
    fun scalesByThePercentage() {
        assertEquals(220, waterMlOf(250, 88))
        assertEquals(293, waterMlOf(333, 88))
    }

    @Test
    fun roundsHalvesUp() {
        assertEquals(149, waterMlOf(150, 99))
        assertEquals(1, waterMlOf(1, 50))
        assertEquals(0, waterMlOf(1, 49))
    }

    @Test
    fun todayTotalSumsWater() {
        val reminders = ReminderSettings(true, 60, 60, LocalTime.of(8, 0), LocalTime.of(22, 0), true)
        val logs = listOf(
            DrinkLog(2, Instant.EPOCH, 250, 4, waterMlOf(250, 88)),
            DrinkLog(1, Instant.EPOCH, 300, 1, 300),
        )
        val snapshot = Snapshot(
            Settings(2000, reminders, null, null), emptyList(), emptyList(), logs, Instant.EPOCH, logs.first(),
            Preset(null, null, null),
        )
        assertEquals(520, snapshot.todayMl)
    }
}
