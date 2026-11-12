package app.sip.core.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import app.sip.core.data.Repo
import app.sip.core.domain.Rejected
import java.time.Instant
import kotlin.concurrent.thread

private const val TAG = "SipReminders"

/** Receivers get about ten seconds on the main thread. SQLite goes off it, with `goAsync` keeping the process alive. */
private fun BroadcastReceiver.async(block: () -> Unit) {
    val pending = goAsync()
    thread {
        try {
            block()
        } catch (e: Exception) {
            Log.e(TAG, "${javaClass.simpleName} failed", e)
        } finally {
            pending.finish()
        }
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val test = intent.getBooleanExtra(EXTRA_TEST, false)
        async {
            if (test) {
                Notifications.postTest(context)
                return@async
            }
            val repo = Repo.get(context)
            // Re-arming has to happen even when posting fails, or one error ends the whole chain.
            try {
                repo.setLastReminderAt(Instant.now())
                repo.setMissedReminderAt(null)
                Notifications.postReminder(context, repo.snapshot())
            } finally {
                Reconciler.reconcile(context)
            }
        }
    }

    companion object {
        const val EXTRA_TEST = "test"
    }
}

class DrinkActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        async {
            val repo = Repo.get(context)
            try {
                val logged = repo.logPreselected(Instant.now())
                repo.notifyChanged()
                Notifications.postLogged(context, logged)
            } catch (e: Exception) {
                Log.e(TAG, "logging from the notification failed", e)
                Notifications.postLogFailed(context, (e as? Rejected)?.message)
            } finally {
                Reconciler.reconcile(context)
            }
        }
    }
}

class SystemEventReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "reconciling after ${intent.action}")
        async { Reconciler.reconcile(context) }
    }
}
