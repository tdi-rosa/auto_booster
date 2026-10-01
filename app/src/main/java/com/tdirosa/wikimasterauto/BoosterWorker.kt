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

        if (!manualRun && !prefs.getBoolean("enabled", false)) {
            return Result.success()
        }

        return try {
            val client = WikiMastersClient(applicationContext)
            val count = client.getBoosterCount()

            if (manualRun || count >= 10) {
                val cards = client.openAllAvailableBoosters()
                val rareCards = cards.filter { it.rarity.isAboveSuperRare() }

                if (rareCards.isNotEmpty()) {
                    RareHistoryStore.addAll(applicationContext, rareCards)
                    NotificationHelper.notifyRarePulls(applicationContext, rareCards)
                }
            }

            Result.success()
        } catch (e: WikiMastersNotConfiguredException) {
            NotificationHelper.notifyNeedsSetup(applicationContext)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
