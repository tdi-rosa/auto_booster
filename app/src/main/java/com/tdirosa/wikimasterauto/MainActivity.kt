package com.tdirosa.wikimasterauto

import android.Manifest
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.webkit.CookieManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.RadioGroup
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.work.WorkManager
import androidx.lifecycle.lifecycleScope
import coil.load
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.ceil

class MainActivity : AppCompatActivity() {
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    private lateinit var automationSwitch: SwitchCompat
    private lateinit var loginButton: Button
    private lateinit var openNowButton: Button
    private lateinit var refreshHistoryButton: Button
    private lateinit var intervalSpinner: Spinner
    private lateinit var historySortSpinner: Spinner
    private lateinit var rarityGroup: RadioGroup
    private lateinit var rarityValue: TextView
    private lateinit var statusText: TextView
    private lateinit var sessionText: TextView
    private lateinit var nextRunText: TextView
    private lateinit var runInfoText: TextView
    private lateinit var historyCountText: TextView
    private lateinit var emptyHistoryText: TextView
    private lateinit var historyContainer: LinearLayout

    private val intervalValues = listOf(15L, 30L, 60L, 90L, 100L, 120L, 180L)
    private var imageBackfillRunning = false
    private val failedImageFallbacks = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        bindViews()
        NotificationHelper.createChannel(this)

        if (Build.VERSION.SDK_INT >= 33) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        automationSwitch.isChecked = prefs.getBoolean("enabled", false)

        setupIntervalSelector()
        setupRaritySelector()
        setupHistorySorting()
        setupActions()
        observeManualWork()

        if (prefs.getBoolean("enabled", false)) {
            AutomationScheduler.ensureScheduled(this)
        }

        renderAll()
    }

    override fun onResume() {
        super.onResume()
        if (::statusText.isInitialized) renderAll()
    }

    private fun bindViews() {
        automationSwitch = findViewById(R.id.automationSwitch)
        loginButton = findViewById(R.id.loginButton)
        openNowButton = findViewById(R.id.openNowButton)
        refreshHistoryButton = findViewById(R.id.refreshHistoryButton)
        intervalSpinner = findViewById(R.id.intervalSpinner)
        historySortSpinner = findViewById(R.id.historySortSpinner)
        rarityGroup = findViewById(R.id.rarityGroup)
        rarityValue = findViewById(R.id.rarityValue)
        statusText = findViewById(R.id.statusText)
        sessionText = findViewById(R.id.sessionText)
        nextRunText = findViewById(R.id.nextRunText)
        runInfoText = findViewById(R.id.runInfoText)
        historyCountText = findViewById(R.id.historyCountText)
        emptyHistoryText = findViewById(R.id.emptyHistoryText)
        historyContainer = findViewById(R.id.historyContainer)
    }

    private fun setupIntervalSelector() {
        val labels = listOf(
            "15 min",
            "30 min",
            "1 h",
            "1 h 30",
            "1 h 40",
            "2 h",
            "3 h"
        )
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val saved = prefs.getLong(
            "open_interval_minutes",
            AutomationScheduler.DEFAULT_INTERVAL_MINUTES
        )
        val selectedIndex = intervalValues.indexOf(saved).takeIf { it >= 0 }
            ?: intervalValues.indexOf(AutomationScheduler.DEFAULT_INTERVAL_MINUTES)

        intervalSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            labels
        )
        intervalSpinner.setSelection(selectedIndex)
        intervalSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                val newInterval = intervalValues[position]
                val current = prefs.getLong(
                    "open_interval_minutes",
                    AutomationScheduler.DEFAULT_INTERVAL_MINUTES
                )
                if (newInterval != current) {
                    prefs.edit().putLong("open_interval_minutes", newInterval).apply()
                    if (prefs.getBoolean("enabled", false)) {
                        AutomationScheduler.updateSchedule(this@MainActivity)
                    }
                    renderNextRun()
                }
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun setupRaritySelector() {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val rank = prefs.getInt("notification_min_rank", Rarity.ULTRA_RARE.rank)
            .coerceIn(Rarity.COMMON.rank, Rarity.LEGENDARY.rank)

        val idByRank = mapOf(
            Rarity.COMMON.rank to R.id.rarityC,
            Rarity.UNCOMMON.rank to R.id.rarityPC,
            Rarity.RARE.rank to R.id.rarityR,
            Rarity.SUPER_RARE.rank to R.id.raritySR,
            Rarity.ULTRA_RARE.rank to R.id.rarityUR,
            Rarity.LEGENDARY.rank to R.id.rarityL
        )
        rarityGroup.check(idByRank.getValue(rank))
        renderRarity(rank)

        val rankById = idByRank.entries.associate { (rankValue, viewId) -> viewId to rankValue }
        rarityGroup.setOnCheckedChangeListener { _, checkedId ->
            val selectedRank = rankById[checkedId] ?: return@setOnCheckedChangeListener
            prefs.edit().putInt("notification_min_rank", selectedRank).apply()
            renderRarity(selectedRank)
        }
    }

    private fun setupHistorySorting() {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val labels = listOf(
            "Plus récentes",
            "Plus anciennes",
            "Rareté ↓",
            "Rareté ↑",
            "Nom A → Z"
        )
        historySortSpinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            labels
        )
        historySortSpinner.setSelection(
            prefs.getInt("history_sort", 0).coerceIn(0, labels.lastIndex)
        )
        historySortSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                if (prefs.getInt("history_sort", 0) != position) {
                    prefs.edit().putInt("history_sort", position).apply()
                }
                renderHistory()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun setupActions() {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)

        automationSwitch.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("enabled", isChecked).apply()
            if (isChecked) {
                AutomationScheduler.updateSchedule(this)
            } else {
                AutomationScheduler.disable(this)
            }
            renderStatus()
            renderNextRun()
        }

        loginButton.setOnClickListener {
            startActivity(Intent(this, LoginActivity::class.java))
        }

        openNowButton.setOnClickListener {
            openNowButton.isEnabled = false
            openNowButton.text = "Ouverture en cours…"
            AutomationScheduler.runNow(this)
        }

        refreshHistoryButton.setOnClickListener {
            renderAll()
        }
    }

    private fun observeManualWork() {
        WorkManager.getInstance(this)
            .getWorkInfosForUniqueWorkLiveData(AutomationScheduler.MANUAL_WORK_NAME)
            .observe(this) { infos ->
                val running = infos.orEmpty().any { !it.state.isFinished }
                openNowButton.isEnabled = !running
                openNowButton.text = if (running) {
                    "Ouverture en cours…"
                } else {
                    "Ouvrir tous les boosters maintenant"
                }
                if (!running) renderAll()
            }
    }

    private fun renderAll() {
        renderStatus()
        renderSession()
        renderNextRun()
        renderRunInfo()
        renderHistory()
    }

    private fun renderStatus() {
        val enabled = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
            .getBoolean("enabled", false)
        statusText.text = if (enabled) {
            "Automatisation active"
        } else {
            "Automatisation en pause"
        }
    }

    private fun renderSession() {
        val cookie = CookieManager.getInstance().getCookie(WikiMastersClient.BASE_URL)
        val connected = !cookie.isNullOrBlank()

        if (connected) {
            sessionText.text = "●  Compte WikiMasters connecté"
            sessionText.setTextColor(Color.parseColor("#166534"))
            sessionText.setBackgroundResource(R.drawable.status_connected_background)
        } else {
            sessionText.text = "●  Non connecté"
            sessionText.setTextColor(Color.parseColor("#991B1B"))
            sessionText.setBackgroundResource(R.drawable.status_disconnected_background)
        }
    }

    private fun renderRarity(rank: Int) {
        val rarity = Rarity.fromRank(rank)
        rarityValue.text = if (rarity == Rarity.LEGENDARY) {
            "Notification uniquement pour les cartes L"
        } else {
            "Notification à partir de ${rarity.code}"
        }
    }

    private fun renderNextRun() {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        if (!prefs.getBoolean("enabled", false)) {
            nextRunText.text = "Aucune ouverture automatique planifiée"
            return
        }

        val nextRun = prefs.getLong("next_run_at", 0L)
        if (nextRun <= 0L) {
            nextRunText.text = "Planification en cours…"
            return
        }

        val now = System.currentTimeMillis()
        if (nextRun <= now) {
            nextRunText.text = "Prochaine ouverture dès que possible"
            return
        }

        val remainingMinutes = ceil((nextRun - now) / 60_000.0).toLong()
        val clock = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(nextRun))
        nextRunText.text = "Prochaine ouverture vers $clock • dans ~${formatDuration(remainingMinutes)}"
    }

    private fun renderRunInfo() {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val boosters = prefs.getInt("last_boosters_opened", 0)
        val cards = prefs.getInt("last_cards_opened", 0)
        val remaining = prefs.getInt("last_packs_remaining", -1)
        val error = prefs.getString("last_error", "").orEmpty()
        val lastOpen = prefs.getLong("last_open_at", 0L)

        runInfoText.text = when {
            error.isNotBlank() -> "Dernière erreur : $error"
            lastOpen > 0L -> {
                val date = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                    .format(Date(lastOpen))
                "$boosters booster(s) • $cards cartes • $remaining restant(s)\n$date"
            }
            else -> "Aucune ouverture enregistrée pour le moment"
        }
    }

    private fun renderHistory() {
        val prefs = getSharedPreferences("wikimaster_auto", MODE_PRIVATE)
        val pulls = RareHistoryStore.read(this)
        backfillMissingImages(pulls)
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

        historyContainer.removeAllViews()
        historyCountText.text = if (pulls.size <= 1) {
            "${pulls.size} carte enregistrée"
        } else {
            "${pulls.size} cartes enregistrées"
        }

        emptyHistoryText.visibility = if (sorted.isEmpty()) View.VISIBLE else View.GONE
        if (sorted.isEmpty()) return

        val inflater = LayoutInflater.from(this)
        val formatter = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)

        sorted.forEach { pull ->
            val item = inflater.inflate(R.layout.item_history_card, historyContainer, false)
            val image = item.findViewById<ImageView>(R.id.cardImage)
            val rarity = item.findViewById<TextView>(R.id.cardRarity)
            val title = item.findViewById<TextView>(R.id.cardTitle)
            val date = item.findViewById<TextView>(R.id.cardDate)
            val browserButton = item.findViewById<Button>(R.id.cardBrowserButton)

            rarity.text = pull.rarity
            title.text = pull.title
            date.text = formatter.format(Date(pull.pulledAtEpochMs))

            if (pull.imageUrl.isNullOrBlank()) {
                image.setImageResource(R.drawable.app_icon)
                image.scaleType = ImageView.ScaleType.CENTER_INSIDE
            } else {
                image.scaleType = ImageView.ScaleType.CENTER_CROP
                image.load(pull.imageUrl) {
                    crossfade(true)
                    placeholder(R.drawable.app_icon)
                    error(R.drawable.app_icon)
                    listener(
                        onError = { _, _ ->
                            fallbackImageFromWikipedia(pull.title)
                        }
                    )
                }
            }

            val url = pull.wikipediaUrl
            if (url.isNullOrBlank()) {
                browserButton.visibility = View.GONE
            } else {
                browserButton.setOnClickListener {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                }
            }

            historyContainer.addView(item)
        }
    }


    private fun backfillMissingImages(pulls: List<RarePull>) {
        if (imageBackfillRunning) return

        val titles = pulls
            .filter { it.imageUrl.isNullOrBlank() && !it.imageLookupDone }
            .map { it.title }
            .filter { it.isNotBlank() }
            .distinct()

        if (titles.isEmpty()) return

        imageBackfillRunning = true
        lifecycleScope.launch {
            val resolved = withContext(Dispatchers.IO) {
                WikipediaImageResolver.resolve(titles)
            }

            RareHistoryStore.applyWikipediaImageResults(
                this@MainActivity,
                titles.toSet(),
                resolved
            )
            imageBackfillRunning = false
            renderHistory()
        }
    }

    private fun fallbackImageFromWikipedia(title: String) {
        if (title.isBlank() || !failedImageFallbacks.add(title)) return

        lifecycleScope.launch {
            val resolved = withContext(Dispatchers.IO) {
                WikipediaImageResolver.resolve(listOf(title))
            }

            RareHistoryStore.applyWikipediaImageResults(
                this@MainActivity,
                setOf(title),
                resolved
            )

            if (resolved.containsKey(title)) {
                renderHistory()
            }
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

    private fun formatDuration(minutes: Long): String {
        if (minutes < 60) return "$minutes min"
        val hours = minutes / 60
        val rest = minutes % 60
        return if (rest == 0L) {
            "${hours} h"
        } else {
            "${hours} h ${rest} min"
        }
    }
}
