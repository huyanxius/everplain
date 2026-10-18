package app.everplain.core

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import kotlin.test.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class ResearchArchiveDownloadTest {
    @Test
    fun `archive uses POST original key and bounded verified bytes without redirecting cookies`() =
        runBlocking<Unit> {
            MockWebServer().use { server ->
                server.start()
                val bytes = "synthetic archive".toByteArray()
                val hash =
                    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {
                        "%02x".format(it)
                    }
                val api =
                    EverplainApi(Endpoint.parse(server.url("/").toString(), true), MemoryStore())
                server.enqueue(
                    MockResponse()
                        .setBody(String(bytes))
                        .setHeader("Content-Type", "application/zip")
                        .setHeader(
                            "Content-Disposition",
                            "attachment; filename*=UTF-8''%E7%A0%94%E7%A9%B6%2B1.zip",
                        )
                        .setHeader("X-Qunxue-Artifact-SHA256", hash)
                        .setHeader("X-Qunxue-Exchange-Loss-Count", "3")
                        .setHeader("X-Qunxue-Exchange-Blocking-Loss-Count", "1")
                )
                val output = ByteArrayOutputStream()
                val result =
                    api.downloadResearchArchive(
                        "00000000-0000-0000-0000-000000000001",
                        "original-key",
                        output,
                        64,
                    )
                assertContentEquals(bytes, output.toByteArray())
                assertTrue(result.verifiedServerHash)
                assertEquals("研究+1.zip", result.filename)
                assertEquals(3, result.lossCount)
                val request = server.takeRequest()
                assertEquals("POST", request.method)
                assertEquals("original-key", request.getHeader("Idempotency-Key"))
                assertEquals("application/zip", request.getHeader("Accept"))
                server.enqueue(MockResponse().setBody("oversize"))
                assertFailsWith<IOException> {
                    api.downloadResearchArchive(
                        "00000000-0000-0000-0000-000000000001",
                        "original-key",
                        ByteArrayOutputStream(),
                        1,
                    )
                }
                server.enqueue(
                    MockResponse().setBody("different").setHeader("X-Qunxue-Artifact-SHA256", hash)
                )
                assertFailsWith<IOException> {
                    api.downloadResearchArchive(
                        "00000000-0000-0000-0000-000000000001",
                        "original-key",
                        ByteArrayOutputStream(),
                        64,
                    )
                }
            }
        }
}
