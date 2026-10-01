package com.tdirosa.wikimasterauto

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat

object NotificationHelper {
    private const val CHANNEL_ID = "wikimaster-pulls"

    fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "WikiMaster pulls",
            NotificationManager.IMPORTANCE_DEFAULT
        )
        manager.createNotificationChannel(channel)
    }

    fun notifyRarePulls(context: Context, cards: List<WikiCard>) {
        val text = cards.joinToString(" • ") { "${it.title} (${it.rarity.name})" }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.star_big_on)
            .setContentTitle("Rare WikiMasters pull")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(1001, notification)
    }

    fun notifyNeedsSetup(context: Context) {
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle("WikiMaster Auto needs setup")
            .setContentText("Connect the real WikiMasters API/session in WikiMastersClient.kt.")
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(1002, notification)
    }
}
