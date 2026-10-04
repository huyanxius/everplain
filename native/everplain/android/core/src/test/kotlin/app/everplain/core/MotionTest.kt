package app.everplain.core

import kotlin.test.*

class MotionTest {
    @Test
    fun `display pacing leaves authoritative text intact and never splits Unicode`() {
        val source = "A😀中".repeat(100)
        val pacer = StreamPacer(source, true, false)
        assertEquals("", pacer.visible)
        var now = 0.0
        while (pacer.visible.length < source.length) {
            now += 48
            assertTrue(pacer.tick(now))
            assertFalse(pacer.visible.last().isHighSurrogate())
            assertTrue(source.startsWith(pacer.visible))
            assertEquals(pacer.visible.length, pacer.revealedAt.size)
        }
        assertEquals(source, pacer.visible)
        for (i in source.indices) if (source[i].isLowSurrogate())
            assertEquals(pacer.revealedAt[i - 1], pacer.revealedAt[i])
        pacer.update(source, false, false)
        assertFalse(pacer.tick(now + 1099))
        assertTrue(pacer.tick(now + 1100))
        assertTrue(pacer.revealedAt.isEmpty())
    }

    @Test
    fun `replacement reduced motion and old history do not animate`() {
        val pacer = StreamPacer("historical", false, false)
        assertEquals("historical", pacer.visible)
        pacer.update("replacement", true, false)
        assertEquals("replacement", pacer.visible)
        assertTrue(pacer.revealedAt.isEmpty())
        pacer.update("replacement next", true, true)
        assertEquals("replacement next", pacer.visible)
        assertFalse(pacer.needsTick)
    }

    @Test
    fun `completed stream drains backlog rather than losing final text`() {
        val pacer = StreamPacer("", true, false)
        pacer.update("terminal response", false, false)
        assertEquals("", pacer.visible)
        var now = 0.0
        while (pacer.needsTick) {
            now += 48
            pacer.tick(now)
        }
        assertEquals("terminal response", pacer.visible)
    }

    @Test
    fun `source flight spring has restrained overshoot`() {
        assertEquals(0.0, sourceSpring(0.0), 1e-12)
        assertTrue((0..56).maxOf { sourceSpring(it / 56.0 * .94) } in 1.04..1.05)
    }
}
