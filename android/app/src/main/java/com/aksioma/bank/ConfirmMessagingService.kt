package com.aksioma.bank

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.capacitorjs.plugins.pushnotifications.MessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlin.random.Random

// Розширює сервіс пушів Capacitor: для операцій, що потребують
// підтвердження (kind=confirm-op), будує сповіщення з кнопками
// «Підтвердити»/«Відхилити» просто зі списку, без відкриття застосунку.
// Для решти пушів показує звичайне інформаційне сповіщення.
class ConfirmMessagingService : MessagingService() {

    companion object {
        const val CHANNEL_OPS = "aksioma_ops"
        const val CHANNEL_INFO = "aksioma_info"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        val data = remoteMessage.data
        val title = data["title"] ?: "Аксіома"
        val body = data["body"] ?: ""
        ensureChannels()

        if (data["kind"] == "confirm-op") {
            showConfirmNotification(data["opId"] ?: return, data["uid"] ?: return, title, body)
        } else if (body.isNotEmpty()) {
            showInfoNotification(title, body)
        }
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_OPS, "Підтвердження операцій", NotificationManager.IMPORTANCE_HIGH)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_INFO, "Сповіщення про операції", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    private fun showConfirmNotification(opId: String, uid: String, title: String, body: String) {
        val notifId = Random.nextInt(10000, 999999)

        fun actionIntent(decision: String): PendingIntent {
            val intent = Intent(this, ConfirmActionReceiver::class.java).apply {
                action = "com.aksioma.bank.ACTION_$decision"
                putExtra("opId", opId)
                putExtra("uid", uid)
                putExtra("decision", decision)
                putExtra("notifId", notifId)
            }
            return PendingIntent.getBroadcast(
                this, notifId * 10 + (if (decision == "approve") 1 else 2), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_OPS)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .addAction(0, "Підтвердити", actionIntent("approve"))
            .addAction(0, "Відхилити", actionIntent("decline"))
            .build()

        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(notifId, notification)
    }

    private fun showInfoNotification(title: String, body: String) {
        val notification = NotificationCompat.Builder(this, CHANNEL_INFO)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(Random.nextInt(10000, 999999), notification)
    }
}
