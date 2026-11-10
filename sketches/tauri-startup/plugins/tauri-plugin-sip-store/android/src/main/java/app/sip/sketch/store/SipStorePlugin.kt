package app.sip.sketch.store

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors

@TauriPlugin
class SipStorePlugin(private val activity: Activity) : Plugin(activity) {
    // Tauri dispatches plugin commands on the main thread, so disk work moves to its own thread.
    private val io = Executors.newSingleThreadExecutor()
    private val db by lazy { Db(activity.applicationContext) }

    @Command
    fun snapshot(invoke: Invoke) {
        io.execute {
            try {
                invoke.resolve(db.snapshot())
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.toString())
            }
        }
    }

    @Command
    fun fullyDrawn(invoke: Invoke) {
        activity.runOnUiThread {
            activity.reportFullyDrawn()
            invoke.resolve()
        }
    }
}
