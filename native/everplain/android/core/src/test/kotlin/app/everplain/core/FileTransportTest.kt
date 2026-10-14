package app.everplain.core

import java.io.File
import java.io.IOException
import kotlin.test.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import okio.Buffer

class FileTransportTest {
    @Test
    fun `snapshot enforces limit while streaming and multipart boundary is stable`() {
        val file = File.createTempFile("ep-upload", ".txt")
        try {
            file.writeText("合成文件")
            val snapshot = UploadSnapshot(file, "note.txt", "text/plain", 6)
            assertFailsWith<IOException> { snapshot.body().writeTo(Buffer()) }
            val exact = UploadSnapshot(file, "note.txt", "text/plain", file.length())
            val buffer = Buffer()
            exact.body().writeTo(buffer)
            assertEquals("合成文件", buffer.readUtf8())
            assertEquals(multipartBoundary("original-intent"), multipartBoundary("original-intent"))
            assertNotEquals(
                multipartBoundary("original-intent"),
                multipartBoundary("different-intent"),
            )
        } finally {
            file.delete()
        }
    }

    @Test
    fun `binary material preserves Range and reads 206 bytes using session cookie`() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val endpoint = Endpoint.parse(server.url("/").toString(), true)
            val store = MemoryStore()
            val cookies = SessionCookies(endpoint.url, store)
            cookies.saveFromResponse(
                endpoint.url,
                listOf(
                    okhttp3.Cookie.parse(
                        endpoint.url,
                        "everplain_session=synthetic; Path=/; HttpOnly",
                    )!!
                ),
            )
            val api = EverplainApi(endpoint, store)
            server.enqueue(
                MockResponse()
                    .setResponseCode(206)
                    .setHeader("Content-Type", "application/pdf")
                    .setHeader("Content-Range", "bytes 1-3/8")
                    .setBody("123")
            )
            val data =
                api.materialContent(
                    "00000000-0000-0000-0000-000000000001",
                    "00000000-0000-0000-0000-000000000002",
                    "bytes=1-3",
                    8,
                )
            assertEquals(206, data.status)
            assertEquals("123", data.bytes.toString(Charsets.UTF_8))
            assertEquals("bytes 1-3/8", data.contentRange)
            val request = server.takeRequest()
            assertEquals("bytes=1-3", request.getHeader("Range"))
            assertEquals("everplain_session=synthetic", request.getHeader("Cookie"))
        }
    }

    @Test
    fun `binary size and invalid multi range are rejected without uncontrolled allocation`() =
        runBlocking {
            MockWebServer().use { server ->
                server.start()
                val api =
                    EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
                server.enqueue(MockResponse().setBody("too large"))
                assertFailsWith<IOException> {
                    api.imageAsset("00000000-0000-0000-0000-000000000001", 2)
                }
                assertFailsWith<IllegalArgumentException> {
                    api.materialContent(
                        "00000000-0000-0000-0000-000000000001",
                        "00000000-0000-0000-0000-000000000002",
                        "bytes=0-1,4-5",
                        10,
                    )
                }
                assertEquals(1, server.requestCount)
            }
        }
}
