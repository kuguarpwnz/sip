package app.sip.core.reminders

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import app.sip.core.domain.Logged
import app.sip.core.domain.Snapshot
import app.sip.core.R

internal object Notifications {
    const val CHANNEL_ID = "reminders"
    private const val REMINDER_ID = 1
    private const val TEST_ID = 2
    private const val LOG_FAILED_ID = 3
    private const val LOGGED_TIMEOUT_MS = 1_000L

    fun manager(context: Context): NotificationManager = context.getSystemService(NotificationManager::class.java)

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_HIGH)
        manager(context).createNotificationChannel(channel)
    }

    fun postReminder(context: Context, snapshot: Snapshot) {
        ensureChannel(context)
        val settings = snapshot.settings
        val ml = snapshot.preset.ml
        val type = snapshot.types.firstOrNull { it.id == snapshot.preset.typeId }
        val builder = base(context)
            .setContentTitle("Time for a drink")
            .setContentText(ReminderText.progress(snapshot.todayMl, settings.dailyGoalMl))
            .setCategory(Notification.CATEGORY_REMINDER)
        if (ml != null && type != null) {
            val log = Intent(context, DrinkActionReceiver::class.java)
            val action = PendingIntent.getBroadcast(context, 0, log, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            builder.addAction(Notification.Action.Builder(Icon.createWithResource(context, R.drawable.ic_stat_drop), "+$ml ml ${type.label}", action).build())
        }
        manager(context).notify(REMINDER_ID, builder.build())
    }

    fun postTest(context: Context) {
        ensureChannel(context)
        val notification = base(context)
            .setContentTitle("Test reminder")
            .setContentText("Reminders reach this phone.")
            .build()
        manager(context).notify(TEST_ID, notification)
    }

    /** Replaces the reminder in place. `setOnlyAlertOnce` keeps the replacement silent, and it removes itself after a few seconds. */
    fun postLogged(context: Context, logged: Logged) {
        ensureChannel(context)
        val s = logged.snapshot
        val notification = base(context)
            .setContentTitle("Sip")
            .setContentText(ReminderText.logged(logged.log.ml, s.todayMl, s.settings.dailyGoalMl))
            .setCategory(Notification.CATEGORY_STATUS)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(LOGGED_TIMEOUT_MS)
            .build()
        manager(context).notify(REMINDER_ID, notification)
    }

    /** Separate id, so `cancelReminder` and the next reminder never clear it. `reason` is a `Rejected` message, the only kind fit to show. */
    fun postLogFailed(context: Context, reason: String?) {
        ensureChannel(context)
        val notification = base(context)
            .setContentTitle("Couldn't log the drink")
            .setContentText(reason ?: "Open Sip to log it")
            .setCategory(Notification.CATEGORY_ERROR)
            .build()
        manager(context).notify(LOG_FAILED_ID, notification)
    }

    /** Leaves the "Logged" confirmation alone, since it shares the reminder's id. */
    fun cancelReminder(context: Context) {
        val nm = manager(context)
        val shown = nm.activeNotifications.firstOrNull { it.id == REMINDER_ID } ?: return
        if (shown.notification.category == Notification.CATEGORY_REMINDER) nm.cancel(REMINDER_ID)
    }

    private fun base(context: Context): Notification.Builder {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL_ID)
        else @Suppress("DEPRECATION") Notification.Builder(context)
        builder.setSmallIcon(R.drawable.ic_stat_drop).setAutoCancel(true)
        if (launch != null) {
            val tap = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            builder.setContentIntent(tap)
        }
        return builder
    }
}
