package com.tdirosa.wikimasterauto

import android.content.Context
import org.json.JSONObject

enum class Rarity(val code: String, val rank: Int) {
    COMMON("C", 0),
    UNCOMMON("PC", 1),
    RARE("R", 2),
    SUPER_RARE("SR", 3),
    ULTRA_RARE("UR", 4),
    LEGENDARY("L", 5);

    fun isAboveSuperRare(): Boolean = rank > SUPER_RARE.rank
}

data class WikiCard(
    val id: String,
    val title: String,
    val wikipediaUrl: String?,
    val imageUrl: String?,
    val category: String?,
    val rarity: Rarity,
    val rarityOrder: Int?,
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
        // TODO: call POST /api/packs/open repeatedly and parse each response below.
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
                        rarityOrder = card.optNullableInt("rarity_order"),
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
        "PC" -> Rarity.UNCOMMON
        "R" -> Rarity.RARE
        "SR" -> Rarity.SUPER_RARE
        "UR" -> Rarity.ULTRA_RARE
        "L" -> Rarity.LEGENDARY
        else -> Rarity.COMMON
    }

    private fun JSONObject.optNullableString(key: String): String? =
        if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

    private fun JSONObject.optNullableInt(key: String): Int? =
        if (!has(key) || isNull(key)) null else optInt(key)
}
