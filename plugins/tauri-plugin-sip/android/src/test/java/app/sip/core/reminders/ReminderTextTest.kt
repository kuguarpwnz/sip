package app.sip.core.reminders

import org.junit.Assert.assertEquals
import org.junit.Test

class ReminderTextTest {
    private val nbsp = 0xA0.toChar()

    @Test
    fun `groups thousands with a non-breaking space`() {
        assertEquals("0", ReminderText.ml(0))
        assertEquals("250", ReminderText.ml(250))
        assertEquals("1${nbsp}200", ReminderText.ml(1200))
        assertEquals("12${nbsp}345", ReminderText.ml(12345))
    }

    @Test
    fun `progress reads like the design`() {
        assertEquals("1${nbsp}200 of 2${nbsp}000${nbsp}ml (60%)", ReminderText.progress(1200, 2000))
    }

    @Test
    fun `logged confirmation shows the new total`() {
        assertEquals("Logged 250${nbsp}ml, 1${nbsp}450${nbsp}ml (72%)", ReminderText.logged(250, 1450, 2000))
    }

    @Test
    fun `percent rounds down and may pass 100`() {
        assertEquals(72, ReminderText.percent(1450, 2000))
        assertEquals(125, ReminderText.percent(2500, 2000))
        assertEquals(0, ReminderText.percent(100, 0))
    }
}
