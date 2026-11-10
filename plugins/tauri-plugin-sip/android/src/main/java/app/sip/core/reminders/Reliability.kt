package app.sip.core.reminders

import android.app.Activity
import android.content.Context
import app.sip.core.data.Repo
import app.sip.core.domain.ReminderStatus

object Reliability {
    fun status(context: Context): ReminderStatus =
        ReminderStatus(
            notificationsAllowed = false,
            channelEnabled = false,
            exactAlarmsAllowed = false,
            batteryUnrestricted = false,
            nextReminderAt = Repo.get(context).nextReminderAt(),
            missedReminderAt = null,
        )

    fun openSettings(activity: Activity, target: String) {}
}
