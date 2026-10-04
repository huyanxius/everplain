package app.everplain.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

class Endpoint private constructor(val url: HttpUrl) {
    companion object {
        fun parse(value: String, allowLoopbackTestHttp: Boolean = false): Endpoint {
            val url = value.trim().toHttpUrlOrNull() ?: error("请输入有效的 HTTPS 服务地址")
            require(
                url.username.isEmpty() &&
                    url.password.isEmpty() &&
                    url.query == null &&
                    url.fragment == null &&
                    url.encodedPath == "/"
            ) {
                "服务地址只需 HTTPS 域名，不含路径、账号或参数"
            }
            val loopback = url.host in setOf("localhost", "127.0.0.1", "::1")
            require(url.isHttps || (allowLoopbackTestHttp && loopback)) { "为保护登录信息，服务地址必须使用 HTTPS" }
            return Endpoint(url)
        }
    }

    val origin: String
        get() = url.toString()

    fun path(path: String): HttpUrl = url.newBuilder().encodedPath(path).build()

    /** Only the documented authenticated import-image route may receive this session's cookies. */
    fun imageAssetId(raw: String): String? {
        val resolved = url.resolve(raw) ?: return null
        if (
            resolved.scheme != url.scheme ||
                resolved.host != url.host ||
                resolved.port != url.port ||
                resolved.username.isNotEmpty() ||
                resolved.password.isNotEmpty() ||
                resolved.query != null ||
                resolved.fragment != null
        )
            return null
        val segments = resolved.pathSegments
        if (segments.size != 4 || segments.take(3) != listOf("api", "imports", "assets"))
            return null
        return runCatching { java.util.UUID.fromString(segments.last()).toString() }.getOrNull()
    }
}
