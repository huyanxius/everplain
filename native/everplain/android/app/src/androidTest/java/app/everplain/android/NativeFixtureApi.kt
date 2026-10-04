package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.encodeToString

/**
 * In-process read fixtures shared by UI tests. Unknown endpoints fail instead of reaching a
 * network.
 */
internal open class NativeFixtureApi(endpoint: Endpoint, store: PrivateStore) :
    EverplainApi(endpoint, store) {
    override suspend fun <T> contractJson(
        serializer: DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T {
        check(method == "GET") { "Unexpected synthetic mutation $method $path" }
        return WireJson.decodeFromString(
            serializer,
            fixtureHomeJson(path) ?: error("Unimplemented synthetic endpoint $method $path"),
        )
    }
}

internal fun fixtureHomeJson(path: String): String? =
    when (path) {
        "/api/personal-graph" ->
            WireJson.encodeToString(
                PersonalGraphResponse(
                    "cheng",
                    "#5d8fe6",
                    0,
                    emptyList(),
                    "semantic",
                    "澄",
                    listOf(PersonalGraphNode("self", "我", 0, "self")),
                    0,
                    "synthetic",
                    emptyMap(),
                    0,
                )
            )
        "/api/research-tasks" -> WireJson.encodeToString(ResearchTaskPageResponse(emptyList()))
        else -> null
    }
