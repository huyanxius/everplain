package app.everplain.core

import java.io.File
import java.io.IOException
import java.security.MessageDigest
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.BufferedSink

/** A caller-owned immutable private copy, never a persistently granted external document URI. */
data class UploadSnapshot(
    val file: File,
    val filename: String,
    val mediaType: String,
    val maxBytes: Long,
) {
    init {
        require(maxBytes > 0)
        require(filename.isNotBlank())
        require(!filename.contains('\u0000'))
    }

    fun body(): RequestBody =
        object : RequestBody() {
            override fun contentType() =
                mediaType.toMediaTypeOrNull() ?: "application/octet-stream".toMediaTypeOrNull()

            override fun contentLength() = file.length()

            override fun writeTo(sink: BufferedSink) {
                val length = file.length()
                if (length > maxBytes) throw IOException("文件超过服务器允许的大小。")
                file.inputStream().use { input ->
                    val buffer = ByteArray(32 * 1024)
                    var read = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        read += n
                        if (read > maxBytes || read > length) throw IOException("文件内容已变化，请重新选择。")
                        sink.write(buffer, 0, n)
                    }
                    if (read != length) throw IOException("文件内容已变化，请重新选择。")
                }
            }
        }
}

data class BinaryPayload(
    val bytes: ByteArray,
    val mediaType: String?,
    val contentRange: String?,
    val status: Int,
)

internal fun multipartBoundary(key: String) =
    "everplain-" +
        MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") {
            "%02x".format(it)
        }
