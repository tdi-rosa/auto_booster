package com.tdirosa.wikimasterauto

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

object WikipediaImageResolver {
    private const val API_URL = "https://fr.wikipedia.org/w/api.php"
    private const val MAX_TITLES_PER_REQUEST = 50

    fun resolve(titles: List<String>): Map<String, String> {
        val cleanTitles = titles
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinct()

        if (cleanTitles.isEmpty()) return emptyMap()

        val resolved = mutableMapOf<String, String>()
        cleanTitles.chunked(MAX_TITLES_PER_REQUEST).forEach { batch ->
            resolved += resolveBatch(batch)
        }
        return resolved
    }

    private fun resolveBatch(titles: List<String>): Map<String, String> {
        val encodedTitles = URLEncoder.encode(
            titles.joinToString("|"),
            StandardCharsets.UTF_8.toString()
        )

        val url = URL(
            "$API_URL?action=query" +
                "&format=json" +
                "&formatversion=2" +
                "&origin=*" +
                "&redirects=1" +
                "&prop=pageimages" +
                "&piprop=thumbnail" +
                "&pithumbsize=900" +
                "&titles=$encodedTitles"
        )

        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty(
                "Api-User-Agent",
                "WikiMasterAuto/0.3.1 (https://github.com/tdi-rosa/auto_booster)"
            )
        }

        return try {
            val status = connection.responseCode
            if (status !in 200..299) return emptyMap()

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            parseResponse(body, titles)
        } catch (_: Exception) {
            emptyMap()
        } finally {
            connection.disconnect()
        }
    }

    private fun parseResponse(json: String, requestedTitles: List<String>): Map<String, String> {
        val root = JSONObject(json)
        val query = root.optJSONObject("query") ?: return emptyMap()

        val normalized = mutableMapOf<String, String>()
        val normalizedArray = query.optJSONArray("normalized")
        if (normalizedArray != null) {
            for (i in 0 until normalizedArray.length()) {
                val item = normalizedArray.optJSONObject(i) ?: continue
                val from = item.optString("from")
                val to = item.optString("to")
                if (from.isNotBlank() && to.isNotBlank()) normalized[from] = to
            }
        }

        val redirects = mutableMapOf<String, String>()
        val redirectsArray = query.optJSONArray("redirects")
        if (redirectsArray != null) {
            for (i in 0 until redirectsArray.length()) {
                val item = redirectsArray.optJSONObject(i) ?: continue
                val from = item.optString("from")
                val to = item.optString("to")
                if (from.isNotBlank() && to.isNotBlank()) redirects[from] = to
            }
        }

        val thumbnailByFinalTitle = mutableMapOf<String, String>()
        val pages = query.optJSONArray("pages")
        if (pages != null) {
            for (i in 0 until pages.length()) {
                val page = pages.optJSONObject(i) ?: continue
                val title = page.optString("title")
                val source = page
                    .optJSONObject("thumbnail")
                    ?.optString("source")
                    .orEmpty()

                if (
                    title.isNotBlank() &&
                    source.startsWith("https://") &&
                    (
                        source.contains("upload.wikimedia.org") ||
                            source.contains("thumb.wikimedia.org")
                    )
                ) {
                    thumbnailByFinalTitle[title] = source
                }
            }
        }

        val result = mutableMapOf<String, String>()
        requestedTitles.forEach { requested ->
            var finalTitle = normalized[requested] ?: requested
            val seen = mutableSetOf<String>()
            while (seen.add(finalTitle) && redirects.containsKey(finalTitle)) {
                finalTitle = redirects.getValue(finalTitle)
            }
            thumbnailByFinalTitle[finalTitle]?.let { result[requested] = it }
        }
        return result
    }
}
