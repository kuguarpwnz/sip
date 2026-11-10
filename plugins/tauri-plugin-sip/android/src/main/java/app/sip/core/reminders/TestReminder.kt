package app.sip.core.reminders

import android.app.AlarmManager
import android.content.Context
import java.time.Duration
import java.time.Instant

object TestReminder {
    private const val ALARM_REQUEST_CODE = 2
    private val DELAY = Duration.ofSeconds(60)

    /** Its own request code, so it never replaces the real alarm. */
    fun send(context: Context) {
        val app = context.applicationContext
        val alarms = app.getSystemService(AlarmManager::class.java)
        Reconciler.arm(alarms, Instant.now().plus(DELAY), Reconciler.alarmIntent(app, ALARM_REQUEST_CODE, test = true))
    }
}
