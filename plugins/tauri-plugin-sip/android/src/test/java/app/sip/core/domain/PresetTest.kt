package app.sip.core.domain

import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class PresetTest {
    private fun type(id: Long, position: Int, archived: Boolean = false) =
        DrinkType(id, "Type $id", AppIcon.DROPLET, position, archived, 100)

    private fun volume(id: Long, ml: Int, position: Int) = Volume(id, ml, "", AppIcon.DROPLET, position)

    private val types = listOf(type(1, 0), type(2, 1), type(3, 2, archived = true))
    private val volumes = listOf(volume(10, 150, 0), volume(11, 250, 1), volume(12, 330, 2))

    private fun log(ml: Int, typeId: Long) = DrinkLog(1, Instant.EPOCH, ml, typeId, ml)

    @Test
    fun repeatsTheNewestLogsTypeAndVolume() {
        assertEquals(Preset(2, 12, 330), Preset.derive(log(330, 2), types, volumes))
    }

    @Test
    fun anArchivedTypeFallsBackToTheFirstActiveType() {
        assertEquals(Preset(1, 11, 250), Preset.derive(log(250, 3), types, volumes))
    }

    @Test
    fun anAmountWithoutAVolumeKeepsTheAmountAndSelectsTheFirstVolume() {
        assertEquals(Preset(2, 10, 400), Preset.derive(log(400, 2), types, volumes))
    }

    @Test
    fun noLogsUsesTheFirstVolumeAndFirstActiveType() {
        assertEquals(Preset(1, 10, 150), Preset.derive(null, types, volumes))
    }

    @Test
    fun theFirstMatchingVolumeByPositionWins() {
        val twins = listOf(volume(20, 250, 1), volume(21, 250, 0))
        assertEquals(21L, Preset.derive(log(250, 1), types, twins).volumeId)
    }

    @Test
    fun firstActiveTypeIsByPositionNotInputOrder() {
        val shuffled = listOf(type(1, 5), type(2, 0))
        assertEquals(2L, Preset.derive(null, shuffled, volumes).typeId)
    }
}
