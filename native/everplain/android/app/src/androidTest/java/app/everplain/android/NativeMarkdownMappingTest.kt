package app.everplain.android

import android.text.SpannableStringBuilder
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.noties.markwon.Markwon
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeMarkdownMappingTest {
    @Test
    fun sourcePositionsSurviveFormattingCompletionEntitiesAndCode() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val mapping = MarkdownSourceMap()
        val renderer = Markwon.builder(context).usePlugin(mapping).build()
        val raw =
            "**😀 中文** &amp; [同名](https://example.invalid/同名) 同名\n\n```kotlin\nval x = \"😀\"\n```"
        val rendered = SpannableStringBuilder(renderer.toMarkdown(raw))
        mapping.captureCodeBlocks(rendered)
        fun maps(text: String, source: Int) {
            val output = rendered.toString().indexOf(text)
            assertTrue("Rendered token exists", output >= 0)
            assertEquals(source, mapping.indices[output])
        }
        maps("😀", raw.indexOf("😀"))
        maps("&", raw.indexOf("&amp;"))
        maps("val x", raw.indexOf("val x"))
        val secondRendered = rendered.toString().lastIndexOf("同名")
        assertEquals(raw.indexOf(") 同名") + 2, mapping.indices[secondRendered])
        val before = renderer.toMarkdown("**已经出现")
        val old = mapping.indices[before.toString().indexOf("已")]
        val after = renderer.toMarkdown("**已经出现**")
        assertEquals(old, mapping.indices[after.toString().indexOf("已")])
    }
}
