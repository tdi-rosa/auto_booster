package com.tdirosa.wikimasterauto

import android.content.Context
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.UUID
import java.util.concurrent.TimeUnit

object AutomationScheduler {
    private const val PREFS = "wikimaster_auto"
    private const val AUTO_WORK_NAME = "wikimaster-booster-auto"
    private const val MANUAL_WORK_NAME = "wikimaster-booster-manual"
    const val DEFAULT_INTERVAL_MINUTES = 100L

    fun intervalMinutes(context: Context): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getLong("open_interval_minutes", DEFAULT_INTERVAL_MINUTES)
            .coerceAtLeast(15L)

    fun ensureScheduled(context: Context) {
        enqueuePeriodic(context, ExistingPeriodicWorkPolicy.KEEP)
    }

    fun updateSchedule(context: Context) {
        enqueuePeriodic(context, ExistingPeriodicWorkPolicy.UPDATE)
    }

    private fun enqueuePeriodic(
        context: Context,
        policy: ExistingPeriodicWorkPolicy
    ) {
        val interval = intervalMinutes(context)
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = PeriodicWorkRequestBuilder<BoosterWorker>(
            interval,
            TimeUnit.MINUTES
        )
            .setInitialDelay(interval, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            AUTO_WORK_NAME,
            policy,
            request
        )

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong("next_run_at", System.currentTimeMillis() + interval * 60_000L)
            .apply()
    }

    fun disable(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(AUTO_WORK_NAME)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove("next_run_at")
            .apply()
    }

    fun runNow(context: Context): UUID {
        val input = Data.Builder()
            .putBoolean("manual_run", true)
            .build()

        val request = OneTimeWorkRequestBuilder<BoosterWorker>()
            .setInputData(input)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            MANUAL_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
        return request.id
    }
}
