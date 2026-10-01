package com.tdirosa.wikimasterauto

import android.content.Context
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object AutomationScheduler {
    private const val AUTO_WORK_NAME = "wikimaster-booster-auto"

    fun enable(context: Context) {
        scheduleNext(context, 100)
    }

    fun scheduleNext(context: Context, delayMinutes: Long = 100) {
        val request = OneTimeWorkRequestBuilder<BoosterWorker>()
            .setInitialDelay(delayMinutes, TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            AUTO_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            request
        )
    }

    fun disable(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(AUTO_WORK_NAME)
    }

    fun runNow(context: Context) {
        val input = Data.Builder()
            .putBoolean("manual_run", true)
            .build()

        val request = OneTimeWorkRequestBuilder<BoosterWorker>()
            .setInputData(input)
            .build()

        WorkManager.getInstance(context).enqueue(request)
    }
}
