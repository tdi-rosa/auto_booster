package com.tdirosa.wikimasterauto

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import java.text.DateFormat
import java.util.Date

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
        val loginButton = findViewById<Button>(R.id.loginButton)
        val openNowButton = findViewById<Button>(R.id.openNowButton)
        val refreshHistoryButton = findViewById<Button>(R.id.refreshHistoryButton)
        val statusText = findViewById<TextView>(R.id.statusText)
        val sessionText = findViewById<TextView>(R.id.sessionText)
        val historyText = findViewById<TextView>(R.id.historyText)

        val enabled = prefs.getBoolean("enabled", false)
        automationSwitch.isChecked = enabled
        renderStatus(enabled, statusText)
        renderSession(sessionText)
        renderHistory(historyText)

        if (enabled) AutomationScheduler.enable(this)

        automationSwitch.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("enabled", isChecked).apply()
            if (isChecked) AutomationScheduler.enable(this)
            else AutomationScheduler.disable(this)
            renderStatus(isChecked, statusText)
        }

        loginButton.setOnClickListener {
            startActivity(Intent(this, LoginActivity::class.java))
        }

        openNowButton.setOnClickListener {
            AutomationScheduler.runNow(this)
            statusText.text = "Opening request sent…"
        }

        refreshHistoryButton.setOnClickListener {
            renderHistory(historyText)
            renderSession(sessionText)
        }
    }

    override fun onResume() {
        super.onResume()
        findViewById<TextView?>(R.id.historyText)?.let { renderHistory(it) }
        findViewById<TextView?>(R.id.sessionText)?.let { renderSession(it) }
    }

    private fun renderStatus(enabled: Boolean, status: TextView) {
        status.text = if (enabled) "Automation active" else "Automation inactive"
    }

    private fun renderSession(view: TextView) {
        val cookie = CookieManager.getInstance().getCookie(WikiMastersClient.BASE_URL)
        view.text = if (cookie.isNullOrBlank()) {
            "WikiMasters session: not connected"
        } else {
            "WikiMasters session: connected"
        }
    }

    private fun renderHistory(view: TextView) {
        val pulls = RareHistoryStore.read(this)
        if (pulls.isEmpty()) {
            view.text = "No UR/L pulls recorded yet."
            return
        }

        val formatter = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        view.text = pulls.joinToString("\n\n") { pull ->
            val date = formatter.format(Date(pull.pulledAtEpochMs))
            "${pull.rarity} • ${pull.title}\n$date"
        }
    }
}
