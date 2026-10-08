package app.everplain.core

import kotlin.test.*

class ImageAssetPolicyTest {
    @Test
    fun `authenticated image previews accept only same origin exact supported path`() {
        val endpoint = Endpoint.parse("https://fixture.example.invalid")
        val id = "00000000-0000-0000-0000-000000000001"
        assertEquals(id, endpoint.imageAssetId("/api/imports/assets/$id"))
        assertEquals(
            id,
            endpoint.imageAssetId("https://fixture.example.invalid/api/imports/assets/$id"),
        )
        listOf(
                "https://other.invalid/api/imports/assets/$id",
                "http://fixture.example.invalid/api/imports/assets/$id",
                "https://fixture.example.invalid:8443/api/imports/assets/$id",
                "https://user@fixture.example.invalid/api/imports/assets/$id",
                "/api/imports/assets/$id?token=unexpected",
                "/api/imports/assets/$id#fragment",
                "/api/other/$id",
                "/api/imports/assets/not-an-id",
            )
            .forEach { assertNull(endpoint.imageAssetId(it), it) }
    }
}
