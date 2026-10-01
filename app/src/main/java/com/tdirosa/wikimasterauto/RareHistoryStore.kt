package com.tdirosa.wikimasterauto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class RarePull(
    val cardId: String,
    val title: String,
    val rarity: String,
    val wikipediaUrl: String?,
    val imageUrl: String?,
    val imageLookupDone: Boolean,
    val pulledAtEpochMs: Long
)

object RareHistoryStore {
    private const val PREFS = "wikimaster_auto"
    private const val KEY_HISTORY = "rare_history"

    fun addAll(context: Context, cards: List<WikiCard>) {
        if (cards.isEmpty()) return

        val current = read(context).toMutableList()
        val now = System.currentTimeMillis()

        cards.forEach { card ->
            val imageUrl = normalizeImageUrl(card.imageUrl)
            current.add(
                0,
                RarePull(
                    cardId = card.id,
                    title = card.title,
                    rarity = card.rarity.code,
                    wikipediaUrl = card.wikipediaUrl,
                    imageUrl = imageUrl,
                    imageLookupDone = !imageUrl.isNullOrBlank(),
                    pulledAtEpochMs = now
                )
            )
        }

        write(context, current)
    }

    fun read(context: Context): List<RarePull> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_HISTORY, "[]") ?: "[]"

        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (i in 0 until array.length()) {
                    val item = array.getJSONObject(i)
                    val rawImageUrl = item.optNullableString("image_url")
                    val normalizedImageUrl = normalizeImageUrl(rawImageUrl)

                    add(
                        RarePull(
                            cardId = item.optString("card_id"),
                            title = item.optString("title"),
                            rarity = item.optString("rarity"),
                            wikipediaUrl = item.optNullableString("wikipedia_url"),
                            imageUrl = normalizedImageUrl,
                            imageLookupDone = item.optBoolean(
                                "image_lookup_done",
                                !normalizedImageUrl.isNullOrBlank()
                            ),
                            pulledAtEpochMs = item.optLong("pulled_at")
                        )
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    fun applyWikipediaImageResults(
        context: Context,
        attemptedTitles: Set<String>,
        resolvedImages: Map<String, String>
    ) {
        if (attemptedTitles.isEmpty()) return

        val updated = read(context).map { pull ->
            if (pull.title !in attemptedTitles) {
                pull
            } else {
                pull.copy(
                    imageUrl = normalizeImageUrl(resolvedImages[pull.title]) ?: pull.imageUrl,
                    imageLookupDone = true
                )
            }
        }

        write(context, updated)
    }

    private fun write(context: Context, pulls: List<RarePull>) {
        val json = JSONArray()

        pulls.forEach { pull ->
            json.put(
                JSONObject()
                    .put("card_id", pull.cardId)
                    .put("title", pull.title)
                    .put("rarity", pull.rarity)
                    .put("wikipedia_url", pull.wikipediaUrl)
                    .put("image_url", pull.imageUrl)
                    .put("image_lookup_done", pull.imageLookupDone)
                    .put("pulled_at", pull.pulledAtEpochMs)
            )
        }

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_HISTORY, json.toString())
            .apply()
    }

    private fun normalizeImageUrl(value: String?): String? {
        val raw = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null

        return when {
            raw.startsWith("https://") -> raw
            raw.startsWith("//") -> "https:$raw"
            raw.startsWith("/") -> "${WikiMastersClient.BASE_URL}$raw"
            else -> raw
        }
    }

    private fun JSONObject.optNullableString(key: String): String? =
        if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
}
