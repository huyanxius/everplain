package app.everplain.core

import java.io.IOException
import java.io.OutputStream
import java.net.URLDecoder
import java.security.DigestOutputStream
import java.security.MessageDigest
import okhttp3.Response

data class ResearchArchiveDownload(
    val filename: String,
    val exchangeId: String,
    val sha256: String,
    val verifiedServerHash: Boolean,
    val lossCount: Long,
    val blockingLossCount: Long,
    val bytes: Long,
)

internal fun Response.saveResearchArchive(
    output: OutputStream,
    maxBytes: Long,
): ResearchArchiveDownload {
    val expected = header("X-Qunxue-Artifact-SHA256")?.trim()?.lowercase().orEmpty()
    if (expected.isNotEmpty() && !Regex("[0-9a-f]{64}").matches(expected))
        throw IOException("归档校验信息无效，请重新导出。")
    val hash = MessageDigest.getInstance("SHA-256")
    val size = streamToBounded(DigestOutputStream(output, hash), maxBytes)
    val actual = hash.digest().joinToString("") { "%02x".format(it) }
    if (expected.isNotEmpty() && expected != actual)
        throw IOException("归档校验未通过，保存的文件不能作为完整备份。请重新导出。")
    val encoded =
        Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE)
            .find(header("Content-Disposition").orEmpty())
            ?.groupValues
            ?.get(1)
    val name =
        encoded
            ?.let { runCatching { URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }.getOrNull() }
            ?.takeIf {
                it.isNotBlank() &&
                    it.length <= 240 &&
                    it.none { c -> c == '/' || c == '\\' || c.code < 32 }
            } ?: "research-project.zip"
    fun count(name: String) = header(name)?.toLongOrNull()?.takeIf { it >= 0 } ?: 0L
    return ResearchArchiveDownload(
        name,
        header("X-Qunxue-Exchange-Id").orEmpty(),
        actual,
        expected.isNotEmpty(),
        count("X-Qunxue-Exchange-Loss-Count"),
        count("X-Qunxue-Exchange-Blocking-Loss-Count"),
        size,
    )
}
