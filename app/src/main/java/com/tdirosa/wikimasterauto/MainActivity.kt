package com.tdirosa.wikimasterauto

import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.SeekBar
import android.widget.Spinner
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
        val historySortSpinner = findViewById<Spinner>(R.id.historySortSpinner)
        val raritySeekBar = findViewById<SeekBar>(R.id.raritySeekBar)
        val rarityValue = findViewById<TextView>(R.id.rarityValue)
        val statusText = findViewById<TextView>(R.id.statusText)
        val sessionText = findViewById<TextView>(R.id.sessionText)
        val runInfoText = findViewById<TextView>(R.id.runInfoText)
        val historyText = findViewById<TextView>(R.id.historyText)

        val enabled = prefs.getBoolean("enabled", false)
        automationSwitch.isChecked = enabled

        val savedRank = prefs.getInt("notification_min_rank", Rarity.ULTRA_RARE.rank)
            .coerceIn(Rarity.COMMON.rank, Rarity.LEGENDARY.rank)
        raritySeekBar.max = Rarity.LEGENDARY.rank
        raritySeekBar.progress = savedRank
        renderRarity(savedRank, rarityValue)

        val sortLabels = listOf(
            "Plus récentes",
            "Plus anciennes",
            "Rareté ↓",
            "Rareté ↑",
            "Nom A → Z"
        )
        historySortSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            sortLabels
        )
        historySortSpinner.setSelection(prefs.getInt("history_sort", 0).coerceIn(0, sortLabels.lastIndex))
        historySortSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                prefs.edit().putInt("history_sort", position).apply()
                renderHistory(historyText)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }

        renderAll(statusText, sessionText, runInfoText, historyText)

        if (enabled) AutomationScheduler.enable(this)

        automationSwitch.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("enabled", isChecked).apply()
            if (isChecked) AutomationScheduler.enable(this)
            else AutomationScheduler.disable(this)
            renderStatus(isChecked, statusText)
        }

        raritySeekBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                renderRarity(progress, rarityValue)
                if (fromUser) {
                    prefs.edit().putInt("notification_min_rank", progress).apply()
                }
            }

            override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
        })

        loginButton.setOnClickListener {
            startActivity(Intent(this, LoginActivity::class.java))
        }

        openNowButton.setOnClickListener {
            AutomationScheduler.runNow(this)
            statusText.text = "Opening boosters…"
            openNowButton.postDelayed({
                renderAll(statusText, sessionText, runInfoText, historyText)
            }, 2_500)
        }

        refreshHistoryButton.setOnClickListener {
            renderAll(statusText, sessionText, runInfoText, historyText)
        }
    }

    override fun onResume() {
        super.onResume()
        renderAll(
            findViewById(R.id.statusText),
            findViewById(R.id.sessionText),
            findViewById(R.id.runInfoText),
            findViewById(R.id.historyText)
        )
    }

    private fun renderAll(
        status: TextView,
        session: TextView,
        runInfo: TextView,
        history: TextView
    ) {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        renderStatus(prefs.getBoolean("enabled", false), status)
        renderSession(session)
        renderRunInfo(runInfo)
        renderHistory(history)
    }

    private fun renderStatus(enabled: Boolean, status: TextView) {
        status.text = if (enabled) "Automation active" else "Automation paused"
    }

    private fun renderSession(view: TextView) {
        val cookie = CookieManager.getInstance().getCookie(WikiMastersClient.BASE_URL)
        val connected = !cookie.isNullOrBlank()

        if (connected) {
            view.text = "●  Compte WikiMasters connecté"
            view.setTextColor(Color.parseColor("#166534"))
            view.setBackgroundResource(R.drawable.status_connected_background)
        } else {
            view.text = "●  Non connecté"
            view.setTextColor(Color.parseColor("#991B1B"))
            view.setBackgroundResource(R.drawable.status_disconnected_background)
        }
    }

    private fun renderRarity(rank: Int, view: TextView) {
        val rarity = Rarity.fromRank(rank)
        view.text = "Notify from ${rarity.code} and above"
    }

    private fun renderRunInfo(view: TextView) {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val boosters = prefs.getInt("last_boosters_opened", 0)
        val cards = prefs.getInt("last_cards_opened", 0)
        val remaining = prefs.getInt("last_packs_remaining", -1)
        val error = prefs.getString("last_error", "").orEmpty()
        val lastOpen = prefs.getLong("last_open_at", 0L)

        view.text = when {
            error.isNotBlank() -> "Last run error: $error"
            lastOpen > 0L -> {
                val date = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                    .format(Date(lastOpen))
                "$boosters booster(s) opened • $cards cards • $remaining remaining\n$date"
            }
            else -> "No opening recorded yet"
        }
    }

    private fun renderHistory(view: TextView) {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val pulls = RareHistoryStore.read(this)
        if (pulls.isEmpty()) {
            view.text = "No notified pulls yet."
            return
        }

        val sorted = when (prefs.getInt("history_sort", 0)) {
            1 -> pulls.sortedBy { it.pulledAtEpochMs }
            2 -> pulls.sortedWith(
                compareByDescending<RarePull> { rarityRank(it.rarity) }
                    .thenByDescending { it.pulledAtEpochMs }
            )
            3 -> pulls.sortedWith(
                compareBy<RarePull> { rarityRank(it.rarity) }
                    .thenByDescending { it.pulledAtEpochMs }
            )
            4 -> pulls.sortedBy { it.title.lowercase() }
            else -> pulls.sortedByDescending { it.pulledAtEpochMs }
        }

        val formatter = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        view.text = sorted.joinToString("\n\n") { pull ->
            val date = formatter.format(Date(pull.pulledAtEpochMs))
            "${pull.rarity}  •  ${pull.title}\n$date"
        }
    }

    private fun rarityRank(code: String): Int = when (code.uppercase()) {
        "C" -> 0
        "PC" -> 1
        "R" -> 2
        "SR" -> 3
        "UR" -> 4
        "L" -> 5
        else -> -1
    }
}
