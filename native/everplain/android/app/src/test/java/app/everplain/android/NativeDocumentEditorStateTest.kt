package app.everplain.android

import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import com.mohamedrejeb.richeditor.model.RichTextState
import kotlin.test.*

class NativeDocumentEditorStateTest {
    @Test
    fun `native editor keeps Unicode rich styles and real link targets in Markdown roundtrip`() {
        val state =
            RichTextState().apply {
                setMarkdown("研究😀与**证据**，以及[资料](https://example.invalid/source)。\n\n第二段保留中文。")
            }
        val visible = state.annotatedString.text
        assertTrue(visible.contains("研究😀与证据"))
        assertFalse(visible.contains("**证据**"))
        val saved = state.toMarkdown()
        assertTrue(saved.contains("研究😀"))
        assertTrue(saved.contains("https://example.invalid/source"))
        assertTrue(saved.contains("第二段保留中文"))
        val restored = RichTextState().apply { setMarkdown(saved) }
        assertEquals(visible, restored.annotatedString.text)
    }

    @Test
    fun `native selection editing serializes formatted user text without a browser surface`() {
        val state = RichTextState().apply { setMarkdown("原生编辑") }
        state.selection = TextRange(0, 2)
        state.addSpanStyle(SpanStyle(fontWeight = FontWeight.Bold))
        state.selection = TextRange(state.annotatedString.length)
        state.addTextAfterSelection("与后续输入")
        val saved = state.toMarkdown()
        assertTrue(saved.contains("原生"))
        assertTrue(saved.contains("与后续输入"))
        val restored = RichTextState().apply { setMarkdown(saved) }
        assertEquals(state.annotatedString.text, restored.annotatedString.text)
        assertTrue(saved.contains("**") || saved.contains("__"))
    }
}
