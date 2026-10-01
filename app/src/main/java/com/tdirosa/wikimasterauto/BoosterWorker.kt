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

        if (!manualRun && !automaticEnabled) {
            return Result.success()
        }

        return try {
            val client = WikiMastersClient(applicationContext)
            val cards = client.openAllAvailableBoosters()
            val rareCards = cards.filter { it.rarity.isAboveSuperRare() }

            if (rareCards.isNotEmpty()) {
                RareHistoryStore.addAll(applicationContext, rareCards)
                NotificationHelper.notifyRarePulls(applicationContext, rareCards)
            }

            prefs.edit()
                .putLong("last_open_at", System.currentTimeMillis())
                .putInt("last_cards_opened", cards.size)
                .apply()

            if (automaticEnabled) {
                AutomationScheduler.scheduleNext(applicationContext, 100)
            }

            Result.success()
        } catch (e: WikiMastersNotConfiguredException) {
            NotificationHelper.notifyNeedsSetup(applicationContext)
            Result.success()
        } catch (_: Exception) {
            if (!manualRun && automaticEnabled) {
                AutomationScheduler.scheduleNext(applicationContext, 15)
            }
            Result.success()
        }
    }
}
