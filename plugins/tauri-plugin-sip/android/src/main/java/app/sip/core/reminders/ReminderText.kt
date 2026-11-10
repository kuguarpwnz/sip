package app.sip.core.reminders

/** Digit groups and the unit are joined with non-breaking spaces so a number never wraps mid-way. */
object ReminderText {
    private val NBSP = 0xA0.toChar()

    fun ml(value: Int): String {
        val grouped = Math.abs(value).toString().reversed().chunked(3).joinToString(NBSP.toString()).reversed()
        return if (value < 0) "-$grouped" else grouped
    }

    /** Rounds down, so 100% means the goal is met. */
    fun percent(todayMl: Int, goalMl: Int): Int =
        if (goalMl <= 0) 0 else (todayMl.toLong() * 100 / goalMl).toInt()

    fun progress(todayMl: Int, goalMl: Int): String =
        "${ml(todayMl)} of ${ml(goalMl)}${NBSP}ml (${percent(todayMl, goalMl)}%)"

    fun logged(loggedMl: Int, todayMl: Int, goalMl: Int): String =
        "Logged ${ml(loggedMl)}${NBSP}ml, ${ml(todayMl)}${NBSP}ml (${percent(todayMl, goalMl)}%)"
}
