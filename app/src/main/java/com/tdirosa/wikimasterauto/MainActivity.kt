package com.tdirosa.wikimasterauto

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat

class MainActivity : AppCompatActivity() {
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        NotificationHelper.createChannel(this)

        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val automationSwitch = findViewById<SwitchCompat>(R.id.automationSwitch)
        val openNowButton = findViewById<Button>(R.id.openNowButton)
        val statusText = findViewById<TextView>(R.id.statusText)

        val enabled = prefs.getBoolean("enabled", false)
        automationSwitch.isChecked = enabled
        renderStatus(enabled, statusText)

        if (enabled) AutomationScheduler.enable(this)

        automationSwitch.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("enabled", isChecked).apply()
            if (isChecked) AutomationScheduler.enable(this)
            else AutomationScheduler.disable(this)
            renderStatus(isChecked, statusText)
        }

        openNowButton.setOnClickListener {
            AutomationScheduler.runNow(this)
            statusText.text = "Manual opening requested…"
        }
    }

    private fun renderStatus(enabled: Boolean, status: TextView) {
        status.text = if (enabled) "Automation active" else "Automation inactive"
    }
}
