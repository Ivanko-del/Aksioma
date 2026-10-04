package com.aksioma.bank

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

// Обробляє натискання «Підтвердити»/«Відхилити» у пуші: іде прямо на
// Worker зі збереженим deviceId/deviceSecret (писаним push.js через
// Capacitor Preferences) — застосунок при цьому можна не відкривати.
class ConfirmActionReceiver : BroadcastReceiver() {

    companion object {
        private const val WORKER_URL = "https://aksioma-worker.ivankolodeev2.workers.dev"
        private val executor = Executors.newSingleThreadExecutor()
    }

    override fun onReceive(context: Context, intent: Intent) {
        val opId = intent.getStringExtra("opId") ?: return
        val uid = intent.getStringExtra("uid") ?: return
        val decision = intent.getStringExtra("decision") ?: return
        val notifId = intent.getIntExtra("notifId", 0)
        val appContext = context.applicationContext

        val nm = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(notifId)

        val prefs = appContext.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("axDeviceId", null)
        val deviceSecret = prefs.getString("axDeviceSecret", null)
        if (deviceId == null || deviceSecret == null) {
            notifyResult(appContext, "Не вдалося підтвердити", "Пристрій ще не зареєстровано — відкрий застосунок і спробуй ще раз")
            return
        }

        val pending = goAsync()
        executor.execute {
            try {
                val body = JSONObject()
                    .put("uid", uid).put("deviceId", deviceId).put("deviceSecret", deviceSecret)
                    .put("opId", opId).put("decision", decision)
                    .toString()
                val conn = URL("$WORKER_URL/respond-op").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                    .bufferedReader().use { it.readText() }
                val status = try { JSONObject(text).optString("status") } catch (e: Exception) { "" }
                val title = if (decision == "approve") "Операцію підтверджено" else "Операцію відхилено"
                val resultMsg = when (status) {
                    "done" -> "Готово"
                    "declined" -> "Відхилено"
                    "expired" -> "Час на підтвердження вийшов"
                    "failed" -> "Не вдалося виконати операцію"
                    else -> "Код відповіді: $code"
                }
                notifyResult(appContext, title, resultMsg)
            } catch (e: Exception) {
                notifyResult(appContext, "Немає звʼязку", "Не вдалося надіслати рішення. Спробуй ще раз із застосунку")
            } finally {
                pending.finish()
            }
        }
    }

    private fun notifyResult(context: Context, title: String, body: String) {
        val notification = NotificationCompat.Builder(context, ConfirmMessagingService.CHANNEL_OPS)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify((System.currentTimeMillis() % 100000).toInt(), notification)
    }
}
