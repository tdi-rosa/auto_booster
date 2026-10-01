package com.tdirosa.wikimasterauto

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class BoosterWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences("wikimaster_auto", Context.MODE_PRIVATE)
        val manualRun = inputData.getBoolean("manual_run", false)
        val automaticEnabled = prefs.getBoolean("enabled", false)

        if (!manualRun && !automaticEnabled) return Result.success()

        return try {
            val client = WikiMastersClient(applicationContext)
            val result = client.openAllAvailableBoosters()

            // Keep every pulled card in history.
            RareHistoryStore.addAll(applicationContext, result.cards)

            // The rarity threshold only controls notifications.
            val minimumRank = prefs.getInt("notification_min_rank", Rarity.ULTRA_RARE.rank)
            val cardsToNotify = result.cards.filter { it.rarity.rank >= minimumRank }

            if (cardsToNotify.isNotEmpty()) {
                NotificationHelper.notifyRarePulls(applicationContext, cardsToNotify)
            }

            prefs.edit()
                .putLong("last_open_at", System.currentTimeMillis())
                .putInt("last_cards_opened", result.cards.size)
                .putInt("last_boosters_opened", result.boostersOpened)
                .putInt("last_packs_remaining", result.packsRemaining)
                .putString("last_error", "")
                .apply()

            if (automaticEnabled) {
                AutomationScheduler.scheduleNext(applicationContext, 100)
            }

            Result.success()
        } catch (e: WikiMastersNotConfiguredException) {
            prefs.edit().putString("last_error", e.message ?: "Session missing").apply()
            NotificationHelper.notifyNeedsSetup(applicationContext)
            Result.success()
        } catch (e: Exception) {
            prefs.edit()
                .putString("last_error", e.message ?: e.javaClass.simpleName)
                .apply()

            if (!manualRun && automaticEnabled) {
                AutomationScheduler.scheduleNext(applicationContext, 15)
            }
            Result.success()
        }
    }
}
