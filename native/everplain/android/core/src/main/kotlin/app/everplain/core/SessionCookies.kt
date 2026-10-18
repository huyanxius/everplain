package app.everplain.core

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** Implementations must encrypt at rest; never use ordinary preferences for values. */
interface PrivateStore {
    fun read(key: String): String?

    fun write(key: String, value: String?)

    fun clear()
}

class MemoryStore : PrivateStore {
    private val values = mutableMapOf<String, String>()

    @Synchronized override fun read(key: String) = values[key]

    @Synchronized
    override fun write(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }

    @Synchronized
    override fun clear() {
        values.clear()
    }
}

class SessionCookies(private val origin: HttpUrl, private val store: PrivateStore) : CookieJar {
    private val key = "cookies:${origin}"
    private val cookies =
        store.read(key)?.lineSequence()?.mapNotNull { Cookie.parse(origin, it) }?.toMutableList()
            ?: mutableListOf()

    private fun sameOrigin(url: HttpUrl) =
        url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, incoming: List<Cookie>) {
        if (!sameOrigin(url)) return
        incoming.forEach { next ->
            cookies.removeAll {
                it.name == next.name && it.domain == next.domain && it.path == next.path
            }
            if (next.expiresAt > System.currentTimeMillis() && next.matches(origin)) cookies += next
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (!sameOrigin(url)) return emptyList()
        cookies.removeAll { it.expiresAt <= System.currentTimeMillis() }
        return cookies.filter { it.matches(url) }
    }

    @Synchronized
    fun clear() {
        cookies.clear()
        store.write(key, null)
    }

    private fun persist() {
        store.write(key, cookies.joinToString("\n") { it.toString() })
    }
}
