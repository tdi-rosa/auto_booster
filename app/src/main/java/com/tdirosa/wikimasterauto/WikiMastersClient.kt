package com.tdirosa.wikimasterauto

import android.content.Context
import android.webkit.CookieManager
import kotlinx.coroutines.delay
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

    companion object {
        fun fromRank(rank: Int): Rarity = entries.firstOrNull { it.rank == rank } ?: ULTRA_RARE
    }
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

data class OpenAllResult(
    val cards: List<WikiCard>,
    val boostersOpened: Int,
    val packsRemaining: Int
)

class WikiMastersNotConfiguredException : IllegalStateException(
    "No WikiMasters session found. Please log in from the app first."
)

class WikiMastersHttpException(
    val statusCode: Int,
    message: String
) : IllegalStateException(message)

class WikiMastersClient(private val context: Context) {

    suspend fun openAllAvailableBoosters(): OpenAllResult {
        val allCards = mutableListOf<WikiCard>()
        var boostersOpened = 0
        var packsRemaining = -1

        while (boostersOpened < MAX_PACKS_PER_RUN) {
            val response = openOnePackWithRetry()
            boostersOpened += 1
            allCards += response.cards
            packsRemaining = response.packsRemaining

            if (packsRemaining <= 0) break

            delay(850)
        }

        return OpenAllResult(
            cards = allCards,
            boostersOpened = boostersOpened,
            packsRemaining = packsRemaining
        )
    }

    private suspend fun openOnePackWithRetry(): OpenPackResponse {
        var lastError: Exception? = null

        repeat(3) { attempt ->
            try {
                return openOnePack()
            } catch (e: WikiMastersHttpException) {
                lastError = e
                if (e.statusCode !in listOf(409, 425, 429, 500, 502, 503, 504)) throw e
                delay(1_000L * (attempt + 1))
            }
        }

        throw lastError ?: IllegalStateException("Unable to open booster")
    }

    private fun openOnePack(): OpenPackResponse {
        val cookieManager = CookieManager.getInstance()
        val cookie = cookieManager
            .getCookie(BASE_URL)
            ?.takeIf { it.isNotBlank() }
            ?: throw WikiMastersNotConfiguredException()

        val connection = (URL(OPEN_PACK_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 15_000
            doInput = true
            doOutput = true
            setFixedLengthStreamingMode(0)
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Origin", BASE_URL)
            setRequestProperty("Referer", "$BASE_URL/pulls")
        }

        try {
            connection.outputStream.use { }
            val status = connection.responseCode

            connection.headerFields["Set-Cookie"]
                ?.forEach { cookieManager.setCookie(BASE_URL, it) }
            cookieManager.flush()

            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (status !in 200..299) {
                throw WikiMastersHttpException(
                    status,
                    "WikiMasters HTTP $status: ${body.take(300)}"
                )
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
        private const val MAX_PACKS_PER_RUN = 10
    }
}
