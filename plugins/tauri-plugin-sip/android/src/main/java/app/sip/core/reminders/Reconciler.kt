package app.sip.core.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import app.sip.core.data.Repo
import java.time.Duration
import java.time.Instant

/**
 * Owns the one pending alarm. Every trigger calls `reconcile`, which reads the stored state and
 * makes the alarm match it, so calling it again changes nothing.
 */
object Reconciler {
    private const val ALARM_REQUEST_CODE = 1
    private val MISSED_AFTER = Duration.ofMinutes(10)
    private val lock = Any()

    fun reconcile(context: Context) {
        synchronized(lock) { reconcileLocked(context) }
    }

    private fun reconcileLocked(context: Context) {
        val app = context.applicationContext
        val repo = Repo.get(app)
        val now = Instant.now()

        recordMissed(repo, now)
        Notifications.ensureChannel(app)

        val alarms = app.getSystemService(AlarmManager::class.java)
        val pending = alarmIntent(app, ALARM_REQUEST_CODE, test = false)
        val next = repo.nextReminderAt(now)
        if (next == null) {
            alarms.cancel(pending)
        } else {
            arm(alarms, next, pending)
        }
        repo.setScheduledFor(next)

        val lastDrink = repo.snapshot(now).lastDrinkAt
        val lastReminder = repo.lastReminderAt()
        if (lastDrink != null && (lastReminder == null || lastDrink.isAfter(lastReminder))) {
            Notifications.cancelReminder(app)
        }
    }

    /**
     * Has to run before `scheduledFor` is overwritten, since that overwrite erases the evidence.
     */
    private fun recordMissed(repo: Repo, now: Instant) {
        val scheduled = repo.scheduledFor() ?: return
        val lastReminder = repo.lastReminderAt()
        val overdue = scheduled.isBefore(now.minus(MISSED_AFTER))
        if (overdue && (lastReminder == null || lastReminder.isBefore(scheduled))) repo.setMissedReminderAt(scheduled)
    }

    internal fun alarmIntent(context: Context, requestCode: Int, test: Boolean): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).putExtra(AlarmReceiver.EXTRA_TEST, test)
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    internal fun exactAlarmsAllowed(alarms: AlarmManager): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()

    /** Falls back to an inexact alarm that still fires in Doze, so a revoked permission only costs precision. */
    internal fun arm(alarms: AlarmManager, at: Instant, pending: PendingIntent) {
        val ms = at.toEpochMilli()
        if (exactAlarmsAllowed(alarms)) {
            try {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ms, pending)
                return
            } catch (e: SecurityException) {
                // The permission was revoked between the check and the call.
            }
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ms, pending)
    }
}
