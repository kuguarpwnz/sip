package app.sip.core

import android.Manifest
import android.app.Activity
import android.util.Log
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import app.sip.core.data.ChangeListener
import app.sip.core.data.Json
import app.sip.core.data.Repo
import app.sip.core.domain.Rejected
import app.sip.core.reminders.Reconciler
import app.sip.core.reminders.Reliability
import app.sip.core.reminders.TestReminder
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors
import org.json.JSONObject

private const val TAG = "SipPlugin"

@TauriPlugin(
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")]
)
class SipPlugin(private val activity: Activity) : Plugin(activity) {
    // Tauri dispatches plugin commands on the main thread, so all disk work moves to one background thread.
    private val io = Executors.newSingleThreadExecutor()
    private val context = activity.applicationContext
    private val repo get() = Repo.get(context)

    private val changeListener = ChangeListener { snapshot ->
        trigger("changed", JSObject(Json.snapshot(snapshot).toString()))
    }

    override fun load(webView: WebView) {
        Repo.get(context).addListener(changeListener)
    }

    override fun onDestroy() {
        Repo.get(context).removeListener(changeListener)
        io.shutdown()
    }

    @Command
    fun snapshot(invoke: Invoke) = read(invoke) { Json.snapshot(repo.snapshot()) }

    @Command
    fun logDrink(invoke: Invoke) = write(invoke) {
        val (volumeId, typeId) = Json.parseLogDrink(invoke.getArgs())
        Json.snapshot(repo.logDrink(volumeId, typeId).snapshot)
    }

    @Command
    fun addLog(invoke: Invoke) = write(invoke) { Json.snapshot(repo.addLog(Json.parseNewLog(invoke.getArgs()))) }

    @Command
    fun updateLog(invoke: Invoke) = write(invoke) { Json.snapshot(repo.updateLog(Json.parseLogUpdate(invoke.getArgs()))) }

    @Command
    fun deleteLog(invoke: Invoke) = write(invoke) { Json.snapshot(repo.deleteLog(Json.parseId(invoke.getArgs()))) }

    @Command
    fun saveVolume(invoke: Invoke) = write(invoke) { Json.snapshot(repo.saveVolume(Json.parseVolume(invoke.getArgs()))) }

    @Command
    fun deleteVolume(invoke: Invoke) = write(invoke) { Json.snapshot(repo.deleteVolume(Json.parseId(invoke.getArgs()))) }

    @Command
    fun reorderVolumes(invoke: Invoke) = write(invoke) { Json.snapshot(repo.reorderVolumes(Json.parseIds(invoke.getArgs()))) }

    @Command
    fun saveType(invoke: Invoke) = write(invoke) { Json.snapshot(repo.saveType(Json.parseType(invoke.getArgs()))) }

    @Command
    fun deleteType(invoke: Invoke) = write(invoke) { Json.snapshot(repo.deleteType(Json.parseId(invoke.getArgs()))) }

    @Command
    fun reorderTypes(invoke: Invoke) = write(invoke) { Json.snapshot(repo.reorderTypes(Json.parseIds(invoke.getArgs()))) }

    @Command
    fun saveSettings(invoke: Invoke) = write(invoke) { Json.snapshot(repo.saveSettings(Json.parseSettings(invoke.getArgs()))) }

    @Command
    fun reminderStatus(invoke: Invoke) = read(invoke) { Json.status(Reliability.status(context)) }

    @Command
    fun openSystemSettings(invoke: Invoke) {
        val target = try {
            Json.parseSettingsTarget(invoke.getArgs())
        } catch (e: Rejected) {
            invoke.reject(e.message)
            return
        }
        activity.runOnUiThread {
            try {
                Reliability.openSettings(activity, target)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Could not open settings")
            }
        }
    }

    @Command
    fun sendTestReminder(invoke: Invoke) = io.execute {
        try {
            TestReminder.send(context)
            invoke.resolve()
        } catch (e: Exception) {
            fail(invoke, e)
        }
    }

    @Command
    fun haptic(invoke: Invoke) {
        activity.runOnUiThread {
            activity.window.decorView.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            invoke.resolve()
        }
    }

    @Command
    fun fullyDrawn(invoke: Invoke) {
        activity.runOnUiThread {
            activity.reportFullyDrawn()
            invoke.resolve()
            io.execute { reconcile() }
        }
    }

    private fun read(invoke: Invoke, block: () -> JSONObject) = io.execute {
        try {
            invoke.resolve(JSObject(block().toString()))
        } catch (e: Exception) {
            fail(invoke, e)
        }
    }

    private fun write(invoke: Invoke, block: () -> JSONObject) = io.execute {
        try {
            invoke.resolve(JSObject(block().toString()))
        } catch (e: Exception) {
            fail(invoke, e)
            return@execute
        }
        reconcile()
    }

    private fun reconcile() {
        try {
            Reconciler.reconcile(context)
        } catch (e: Exception) {
            Log.e(TAG, "reconcile failed", e)
        }
    }

    private fun fail(invoke: Invoke, e: Exception) {
        if (e !is Rejected) Log.e(TAG, "${invoke.command} failed", e)
        invoke.reject(e.message ?: e.toString())
    }
}
