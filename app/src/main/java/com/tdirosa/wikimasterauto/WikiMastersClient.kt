package com.tdirosa.wikimasterauto

import android.content.Context

enum class Rarity {
    COMMON,
    UNCOMMON,
    RARE,
    SUPER_RARE,
    LEGENDARY
}

data class WikiCard(
    val title: String,
    val rarity: Rarity
)

class WikiMastersNotConfiguredException : IllegalStateException(
    "WikiMasters API endpoints/session are not configured yet"
)

class WikiMastersClient(private val context: Context) {
    suspend fun getBoosterCount(): Int {
        // TODO: replace with the real authenticated WikiMasters request.
        // Keep all reverse-engineered network details in this file only.
        throw WikiMastersNotConfiguredException()
    }

    suspend fun openAllAvailableBoosters(): List<WikiCard> {
        // TODO: call the real open-booster endpoint repeatedly until the stock is empty,
        // parse the returned cards, and map the game's rarity strings to Rarity.
        throw WikiMastersNotConfiguredException()
    }
}
