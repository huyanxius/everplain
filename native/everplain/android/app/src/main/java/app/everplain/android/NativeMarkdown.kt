package app.everplain.android

import android.content.Intent
import android.graphics.Paint
import android.net.Uri
import android.os.SystemClock
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.LineHeightSpan
import android.text.style.ReplacementSpan
import android.util.TypedValue
import android.widget.TextView
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.toColorInt
import app.everplain.shared.EverplainTokens
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.MarkwonPlugin
import io.noties.markwon.MarkwonVisitor
import io.noties.markwon.core.CorePlugin
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.core.spans.HeadingSpan
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin
import kotlin.math.ceil
import org.commonmark.node.Code
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Node
import org.commonmark.node.Text
import org.commonmark.parser.IncludeSourceSpans
import org.commonmark.parser.Parser

/** CommonMark/GFM as native Android text spans. No HTML surface, remote images or WebView. */
@Composable
fun NativeMarkdown(
    markdown: String,
    modifier: Modifier = Modifier,
    revealedAt: List<Double> = emptyList(),
    revealColor: String? = null,
) {
    val context = LocalContext.current
    val ink = MaterialTheme.colorScheme.onSurface.toArgb()
    val muted = MaterialTheme.colorScheme.outline.toArgb()
    val code = MaterialTheme.colorScheme.surfaceContainerHighest.toArgb()
    val codeBlock = MaterialTheme.colorScheme.surfaceVariant.toArgb()
    val sourceMap = remember { MarkdownSourceMap() }
    val renderer =
        remember(context, ink, muted, code, codeBlock) {
            Markwon.builder(context)
                .usePlugin(StrikethroughPlugin.create())
                .usePlugin(TablePlugin.create(context))
                .usePlugin(TaskListPlugin.create(context))
                .usePlugin(sourceMap)
                .usePlugin(
                    object : AbstractMarkwonPlugin() {
                        override fun configureTheme(builder: MarkwonTheme.Builder) {
                            builder
                                .linkColor(ink)
                                .isLinkUnderlined(true)
                                .codeTextColor(ink)
                                .codeBlockTextColor(ink)
                                .codeBackgroundColor(code)
                                .codeBlockBackgroundColor(codeBlock)
                                .codeBlockMargin(
                                    (16 * context.resources.displayMetrics.density).toInt()
                                )
                                .blockQuoteWidth(
                                    (2 * context.resources.displayMetrics.density).toInt()
                                )
                                .headingTextSizeMultipliers(
                                    floatArrayOf(28f / 17f, 19f / 17f, 1f, 1f, .83f, .67f)
                                )
                                .blockQuoteColor(muted)
                                .headingBreakHeight(0)
                                .thematicBreakColor(muted)
                        }

                        override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                            builder.linkResolver { view, href ->
                                val uri = Uri.parse(href)
                                // Never dispatch model-produced javascript:, file:, intent: or
                                // custom schemes.
                                if (uri.scheme?.lowercase() in setOf("https", "http")) {
                                    runCatching {
                                        view.context.startActivity(
                                            Intent(Intent.ACTION_VIEW, uri)
                                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                        )
                                    }
                                }
                            }
                        }
                    }
                )
                .build()
        }
    AndroidView(
        modifier = modifier.fillMaxWidth(),
        factory = {
            RevealingTextView(it).apply {
                setTextIsSelectable(true)
                includeFontPadding = false
                setPadding(0, 0, 0, 0)
            }
        },
        update = { view ->
            view.typeface = android.graphics.Typeface.SERIF
            view.setTextColor(ink)
            view.setLinkTextColor(ink)
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, EverplainTokens.textReading)
            view.setLineSpacing(0f, 1f)
            val styled = SpannableStringBuilder(renderer.toMarkdown(markdown))
            sourceMap.captureCodeBlocks(styled)
            if (styled.isNotEmpty())
                styled.setSpan(
                    SourceReadingLineHeight(view.resources.displayMetrics.scaledDensity),
                    0,
                    styled.length,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
            val now = SystemClock.uptimeMillis().toDouble()
            val bot =
                runCatching { Color((revealColor ?: "#5d8fe6").toColorInt()) }
                    .getOrDefault(Color(0xff5d8fe6))
            val light =
                if (androidx.core.graphics.ColorUtils.calculateLuminance(ink) > .5)
                    lerp(bot, Color.White, .28f)
                else bot
            sourceMap.indices.forEach { (display, source) ->
                if (
                    display > 0 &&
                        display < styled.length &&
                        styled[display].isLowSurrogate() &&
                        styled[display - 1].isHighSurrogate()
                )
                    return@forEach
                val end =
                    if (
                        display in 0 until styled.length - 1 &&
                            styled[display].isHighSurrogate() &&
                            styled[display + 1].isLowSurrogate()
                    )
                        display + 2
                    else display + 1
                val at = revealedAt.getOrNull(source)
                if (display in 0 until styled.length && at != null && now - at < 1100)
                    styled.setSpan(
                        StreamLightSpan(at, light, Color(ink)),
                        display,
                        end,
                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                    )
            }
            renderer.setParsedMarkdown(view, styled)
            view.animateUntil((revealedAt.maxOrNull() ?: 0.0).toLong() + 1100)
        },
    )
}

/** The Web gives body lines, headings and paragraph gaps different metrics. */
internal class SourceReadingLineHeight(private val scale: Float) : LineHeightSpan {
    override fun chooseHeight(
        text: CharSequence,
        start: Int,
        end: Int,
        spanStart: Int,
        vertical: Int,
        metrics: Paint.FontMetricsInt,
    ) {
        val spanned = text as? Spanned ?: return
        val spans = spanned.getSpans(start, end, Any::class.java)
        // Native table/code spans own their multi-line geometry; never crop their rows.
        if (spans.any { it is ReplacementSpan || it.javaClass.simpleName == "CodeBlockSpan" })
            return
        val heading = spans.filterIsInstance<HeadingSpan>().firstOrNull()
        val logical =
            when {
                heading != null ->
                    (when (heading.level) {
                        1 -> EverplainTokens.textSection
                        2 -> EverplainTokens.textTitle
                        else -> EverplainTokens.textReading
                    }) * EverplainTokens.textTitleLineHeight
                text.subSequence(start, end).isBlank() -> EverplainTokens.textReading * .9f
                else -> EverplainTokens.textReading * EverplainTokens.textReadingLineHeight
            }
        val desired = ceil(logical * scale).toInt()
        val original = metrics.descent - metrics.ascent
        if (original <= 0) return
        val descent = ceil(metrics.descent.toFloat() * desired / original).toInt()
        metrics.descent = descent
        metrics.ascent = descent - desired
        metrics.top = metrics.ascent
        metrics.bottom = metrics.descent
    }
}

/**
 * Source-offset mapping follows the AST's original UTF-16 spans, not rendered-text searches.
 * Closing Markdown delimiters may rebuild spans, but cannot restart their source timestamps.
 */
internal class MarkdownSourceMap : AbstractMarkwonPlugin() {
    val indices = mutableMapOf<Int, Int>()
    private var source = ""
    private val leaves = ArrayDeque<Text>()
    private val blocks = mutableListOf<Pair<Node, String>>()

    override fun processMarkdown(markdown: String): String {
        source = markdown
        return markdown
    }

    override fun configureParser(builder: Parser.Builder) {
        builder.includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES)
    }

    override fun beforeRender(node: Node) {
        indices.clear()
        leaves.clear()
        blocks.clear()
        fun walk(n: Node) {
            if (n is FencedCodeBlock) blocks.add(n to n.literal)
            if (n is IndentedCodeBlock) blocks.add(n to n.literal)
            if (n is Text) leaves.add(n)
            var child = n.firstChild
            while (child != null) {
                walk(child)
                child = child.next
            }
        }
        walk(node)
    }

    override fun configure(registry: MarkwonPlugin.Registry) {
        registry.require(CorePlugin::class.java) { core ->
            core.addOnTextAddedListener { _, literal, start ->
                val node = if (leaves.isEmpty()) null else leaves.removeFirst()
                if (node != null) map(node, literal, start, false)
            }
        }
    }

    override fun configureVisitor(builder: MarkwonVisitor.Builder) {
        builder.on(Code::class.java) { visitor, node ->
            val start = visitor.length()
            visitor.builder().append('\u00a0').append(node.literal).append('\u00a0')
            visitor.setSpansForNodeOptional(node, start)
            map(node, node.literal, start + 1, true)
        }
    }

    fun captureCodeBlocks(styled: Spanned) {
        val spans =
            styled
                .getSpans(0, styled.length, Any::class.java)
                .filter { it.javaClass.simpleName == "CodeBlockSpan" }
                .sortedBy { styled.getSpanStart(it) }
        blocks.zip(spans).forEach { (block, span) ->
            val literal = block.second.trimEnd('\n')
            if (literal.isNotEmpty()) {
                val start = styled.toString().indexOf(literal, styled.getSpanStart(span))
                if (start >= 0 && start + literal.length <= styled.getSpanEnd(span))
                    map(block.first, literal, start, true)
            }
        }
    }

    private fun map(node: Node, literal: String, displayStart: Int, code: Boolean) {
        val spans =
            when (node) {
                is FencedCodeBlock ->
                    node.sourceSpans.drop(1).let {
                        if (node.closingFenceLength != null) it.dropLast(1) else it
                    }
                else -> node.sourceSpans
            }
        val offsets =
            spans
                .flatMap { span -> (span.inputIndex until span.inputIndex + span.length).toList() }
                .filter { it in source.indices }
        if (offsets.isEmpty()) return
        var cursor = 0
        if (code && node is Code) {
            while (cursor < offsets.size && source[offsets[cursor]] == '`') cursor++
        }
        var display = 0
        while (display < literal.length && cursor < offsets.size) {
            val sourceIndex = offsets[cursor]
            val raw = source[sourceIndex]
            if (!code && raw == '&') {
                val end = source.indexOf(';', sourceIndex + 1)
                if (end in (sourceIndex + 1)..minOf(sourceIndex + 32, offsets.last())) {
                    val entity = source.substring(sourceIndex, end + 1)
                    val decoded =
                        android.text.Html.fromHtml(entity, android.text.Html.FROM_HTML_MODE_LEGACY)
                            .toString()
                    if (decoded.isNotEmpty() && literal.startsWith(decoded, display)) {
                        repeat(decoded.length) { indices[displayStart + display++] = sourceIndex }
                        while (cursor < offsets.size && offsets[cursor] <= end) cursor++
                        continue
                    }
                }
            }
            if (
                !code &&
                    raw == '\\' &&
                    cursor + 1 < offsets.size &&
                    source[offsets[cursor + 1]] == literal[display]
            )
                cursor++
            if (
                source[offsets[cursor]] == literal[display] ||
                    (code && literal[display] == ' ' && source[offsets[cursor]] == '\n')
            ) {
                indices[displayStart + display] = offsets[cursor]
                display++
            }
            cursor++
        }
    }
}

private class StreamLightSpan(
    private val at: Double,
    private val bot: Color,
    private val ink: Color,
) : CharacterStyle() {
    override fun updateDrawState(paint: TextPaint) {
        val raw = ((SystemClock.uptimeMillis() - at) / 1100).toFloat().coerceIn(0f, 1f)
        fun ease(t: Float) = CubicBezierEasing(.25f, .6f, .25f, 1f).transform(t.coerceIn(0f, 1f))
        val color =
            when {
                raw < .08f -> bot.copy(alpha = ease(raw / .08f))
                raw < .45f -> lerp(bot, lerp(bot, ink, .55f), ease((raw - .08f) / .37f))
                else -> lerp(lerp(bot, ink, .55f), ink, ease((raw - .45f) / .55f))
            }
        paint.color = color.toArgb()
    }
}

private class RevealingTextView(context: android.content.Context) : TextView(context) {
    private var until = 0L
    private val tick =
        object : Runnable {
            override fun run() {
                invalidate()
                if (isAttachedToWindow && SystemClock.uptimeMillis() < until) postOnAnimation(this)
            }
        }

    fun animateUntil(deadline: Long) {
        until = deadline
        removeCallbacks(tick)
        if (deadline > SystemClock.uptimeMillis()) postOnAnimation(tick)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (SystemClock.uptimeMillis() < until) postOnAnimation(tick)
    }
}
