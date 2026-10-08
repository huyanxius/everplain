package app.everplain.core

import java.io.IOException
import kotlin.test.*
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer

class BoundedJsonTest {
    private fun response(body: ResponseBody) =
        Response.Builder()
            .request(Request.Builder().url("https://fixture.example.invalid").build())
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .body(body)
            .build()

    @Test
    fun `JSON bound preserves UTF8 and byte order mark semantics`() {
        val raw = "\uFEFF{\"message\":\"中文😀\"}".toByteArray()
        response(raw.toResponseBody()).use {
            assertEquals("{\"message\":\"中文😀\"}", it.checkedJsonText(100))
        }
    }

    @Test
    fun `known and unknown response lengths reject excessive bytes before decoding`() {
        response("long response".toResponseBody()).use {
            assertFailsWith<IOException> { it.checkedJsonText(4) }
        }
        val unknown =
            object : ResponseBody() {
                override fun contentType(): MediaType? = null

                override fun contentLength() = -1L

                override fun source() = Buffer().writeUtf8("long response")
            }
        response(unknown).use { assertFailsWith<IOException> { it.checkedJsonText(4) } }
    }
}
