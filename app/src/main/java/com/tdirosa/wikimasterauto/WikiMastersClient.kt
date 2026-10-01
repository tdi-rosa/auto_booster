package com.tdirosa.wikimasterauto

import android.content.Context
import org.json.JSONObject

enum class Rarity {
    COMMON,
    UNCOMMON,
    RARE,
    SUPER_RARE,
    LEGENDARY
}

data class WikiCard(
    val id: String,
    val title: String,
    val wikipediaUrl: String?,
    val imageUrl: String?,
    val category: String?,
    val rarity: Rarity,
    val attack: Int?,
    val defense: Int?
)

data class OpenPackResponse(
    val cards: List<WikiCard>,
    val packsRemaining: Int
)

class WikiMastersNotConfiguredException : IllegalStateException(
    "WikiMasters API/session is not configured yet"
)

class WikiMastersClient(private val context: Context) {
    suspend fun getBoosterCount(): Int {
        // TODO: identify the endpoint used by WikiMasters to read current pack stock.
        throw WikiMastersNotConfiguredException()
    }

    suspend fun openAllAvailableBoosters(): List<WikiCard> {
        // TODO: call POST /api/packs/open and parse each JSON response below.
        throw WikiMastersNotConfiguredException()
    }

    internal fun parseOpenPackResponse(json: String): OpenPackResponse {
        val root = JSONObject(json)
        val cardsJson = root.getJSONArray("cards")

        val cards = buildList {
            for (i in 0 until cardsJson.length()) {
                val card = cardsJson.getJSONObject(i)

                add(
                    WikiCard(
                        id = card.getString("id"),
                        title = card.getString("wikipedia_title"),
                        wikipediaUrl = card.optNullableString("wikipedia_url"),
                        imageUrl = card.optNullableString("image_url"),
                        category = card.optNullableString("category"),
                        rarity = parseRarity(card.optString("rarity", "C")),
                        attack = card.optNullableInt("atk"),
                        defense = card.optNullableInt("def")
                    )
                )
            }
        }

        return OpenPackResponse(
            cards = cards,
            packsRemaining = root.getInt("packs_remaining")
        )
    }

    private fun parseRarity(value: String): Rarity = when (value.uppercase()) {
        "C" -> Rarity.COMMON
        "U", "UC" -> Rarity.UNCOMMON
        "R" -> Rarity.RARE
        "SR", "S" -> Rarity.SUPER_RARE
        "L", "LR", "LEGENDARY" -> Rarity.LEGENDARY
        else -> Rarity.COMMON
    }

    private fun JSONObject.optNullableString(key: String): String? =
        if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

    private fun JSONObject.optNullableInt(key: String): Int? =
        if (!has(key) || isNull(key)) null else optInt(key)
}
