package com.tdirosa.wikimasterauto

import android.content.Context
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

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
    "No WikiMasters session found. Please log in from the app first."
)

class WikiMastersClient(private val context: Context) {

    suspend fun openAllAvailableBoosters(): List<WikiCard> {
        val allCards = mutableListOf<WikiCard>()

        var response = openOnePack()
        allCards += response.cards

        while (response.packsRemaining > 0) {
            response = openOnePack()
            allCards += response.cards
        }

        return allCards
    }

    private fun openOnePack(): OpenPackResponse {
        val cookie = CookieManager.getInstance()
            .getCookie(BASE_URL)
            ?.takeIf { it.isNotBlank() }
            ?: throw WikiMastersNotConfiguredException()

        val connection = (URL(OPEN_PACK_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 15_000
            doInput = true
            doOutput = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Origin", BASE_URL)
            setRequestProperty("Referer", "$BASE_URL/pulls")
        }

        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }

            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (status !in 200..299) {
                throw IllegalStateException("WikiMasters HTTP $status: $body")
            }

            return parseOpenPackResponse(body)
        } finally {
            connection.disconnect()
        }
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

    companion object {
        const val BASE_URL = "https://www.wiki-masters.com"
        const val OPEN_PACK_URL = "$BASE_URL/api/packs/open"
    }
}
