package app.sip.core.reminders

import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import app.sip.core.data.Repo
import app.sip.core.domain.ReminderStatus

object Reliability {
    fun status(context: Context): ReminderStatus {
        val app = context.applicationContext
        val repo = Repo.get(app)
        val notifications = Notifications.manager(app)
        val alarms = app.getSystemService(AlarmManager::class.java)
        val power = app.getSystemService(PowerManager::class.java)
        return ReminderStatus(
            notificationsAllowed = notifications.areNotificationsEnabled(),
            channelEnabled = channelEnabled(notifications),
            exactAlarmsAllowed = Reconciler.exactAlarmsAllowed(alarms),
            batteryUnrestricted = power.isIgnoringBatteryOptimizations(app.packageName),
            nextReminderAt = repo.nextReminderAt(),
            missedReminderAt = repo.missedReminderAt(),
        )
    }

    /** A channel that does not exist yet counts as enabled, because creating it gives it full importance. */
    private fun channelEnabled(notifications: NotificationManager): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        val channel = notifications.getNotificationChannel(Notifications.CHANNEL_ID) ?: return true
        return channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun openSettings(activity: Activity, target: String) {
        val pkg = activity.packageName
        val packageUri = Uri.fromParts("package", pkg, null)
        val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri)
        val intent = when (target) {
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            "exactAlarms" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri)
                else appDetails
            "battery" -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri)
            "app" -> appDetails
            else -> throw IllegalArgumentException("Unknown settings target: $target")
        }
        try {
            activity.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            activity.startActivity(appDetails)
        }
    }
}
