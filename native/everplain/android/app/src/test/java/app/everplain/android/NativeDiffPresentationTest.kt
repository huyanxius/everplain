package app.everplain.android

import kotlin.test.*

class NativeDiffPresentationTest {
    private fun before(parts: List<NativeDiffPart>) =
        parts.filter { it.kind != "inserted" }.joinToString("") { it.text }

    private fun after(parts: List<NativeDiffPart>) =
        parts.filter { it.kind != "deleted" }.joinToString("") { it.text }

    private fun check(raw: List<NativeDiffPart>): List<NativeDiffPart> {
        val copy = raw.toList()
        val shown = displayDiffParts(raw)
        assertEquals(before(raw), before(shown))
        assertEquals(after(raw), after(shown))
        assertEquals(copy, raw)
        shown.forEach { part ->
            var i = 0
            while (i < part.text.length) {
                val ch = part.text[i++]
                if (ch.isHighSurrogate())
                    assertTrue(i < part.text.length && part.text[i++].isLowSurrogate())
                else assertFalse(ch.isLowSurrogate())
            }
        }
        return shown
    }

    @Test
    fun `common high surrogate becomes two whole changed emoji only for display`() {
        val shown =
            check(
                listOf(
                    NativeDiffPart("unchanged", "中文\uD83D"),
                    NativeDiffPart("deleted", "\uDE00"),
                    NativeDiffPart("inserted", "\uDE03"),
                    NativeDiffPart("unchanged", "结尾"),
                )
            )
        assertEquals(
            listOf(
                NativeDiffPart("unchanged", "中文"),
                NativeDiffPart("deleted", "😀"),
                NativeDiffPart("inserted", "😃"),
                NativeDiffPart("unchanged", "结尾"),
            ),
            shown,
        )
    }

    @Test
    fun `common low surrogate is duplicated into the matching old and new scalar`() {
        check(
            listOf(
                NativeDiffPart("deleted", "\uD83D"),
                NativeDiffPart("inserted", "\uD83E"),
                NativeDiffPart("unchanged", "\uDD20后文"),
            )
        )
    }

    @Test
    fun `ordinary complete Unicode parts remain unchanged`() {
        val raw =
            listOf(
                NativeDiffPart("unchanged", "甲😀"),
                NativeDiffPart("deleted", "母亲"),
                NativeDiffPart("inserted", "祖辈"),
            )
        assertEquals(raw, check(raw))
    }

    @Test
    fun `malformed original source units are retained rather than silently discarded`() {
        val raw = listOf(NativeDiffPart("unchanged", "\uD83D"))
        assertEquals(raw, displayDiffParts(raw))
    }
}
