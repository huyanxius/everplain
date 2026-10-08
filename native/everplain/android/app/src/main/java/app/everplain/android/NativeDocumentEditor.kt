package app.everplain.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mohamedrejeb.richeditor.model.RichTextState
import com.mohamedrejeb.richeditor.ui.BasicRichTextEditor
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first

private class DocumentEditorBinding(var applied: String, var serialized: String)

/** Real native rich text, not a Markdown-source textarea or HTML surface. */
@Composable
internal fun NativeDocumentEditor(
    identity: String,
    markdown: String,
    change: (String) -> Unit,
    modifier: Modifier = Modifier,
    readOnly: Boolean = false,
) {
    val editor = remember(identity) { RichTextState().apply { setMarkdown(markdown) } }
    val binding = remember(identity) { DocumentEditorBinding(markdown, editor.toMarkdown()) }
    val currentChange by rememberUpdatedState(change)
    val ink = MaterialTheme.colorScheme.onSurface
    val code = MaterialTheme.colorScheme.surfaceContainerHighest
    val context = LocalContext.current
    val links =
        remember(context) {
            object : UriHandler {
                override fun openUri(uri: String) {
                    val parsed = Uri.parse(uri)
                    if (parsed.scheme in setOf("https", "http") && !parsed.host.isNullOrEmpty())
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, parsed)) }
                }
            }
        }
    LaunchedEffect(editor, ink, code) {
        editor.config.linkColor = ink
        editor.config.linkTextDecoration = TextDecoration.Underline
        editor.config.codeSpanColor = ink
        editor.config.codeSpanBackgroundColor = code
        editor.config.codeSpanStrokeColor = code
    }
    LaunchedEffect(editor, markdown) {
        if (markdown == binding.applied || markdown == binding.serialized) {
            binding.applied = markdown
            return@LaunchedEffect
        }
        // A confirmed server version must not detach or overwrite an active IME composition.
        if (editor.composition != null) snapshotFlow { editor.composition }.first { it == null }
        val normalized = RichTextState().apply { setMarkdown(markdown) }.toMarkdown()
        if (normalized != editor.toMarkdown()) editor.setMarkdown(markdown)
        binding.applied = markdown
        binding.serialized = editor.toMarkdown()
    }
    LaunchedEffect(editor) {
        snapshotFlow {
                editor.annotatedString
                editor.toMarkdown()
            }
            .distinctUntilChanged()
            .collect { next ->
                if (next != binding.serialized) {
                    binding.serialized = next
                    currentChange(next)
                }
            }
    }
    DisposableEffect(editor) {
        onDispose {
            val latest = editor.toMarkdown()
            if (latest != binding.serialized) {
                binding.serialized = latest
                currentChange(latest)
            }
        }
    }
    CompositionLocalProvider(LocalUriHandler provides links) {
        // The pinned library's default ImageLoader returns null; no image URLs are fetched.
        BasicRichTextEditor(
            editor,
            modifier.fillMaxWidth().heightIn(min = 288.dp).semantics {
                contentDescription = "研究文档正文"
            },
            readOnly = readOnly,
            maxLength = 100000,
            cursorBrush = SolidColor(ink),
            textStyle =
                MaterialTheme.typography.bodyLarge.copy(
                    color = ink,
                    fontFamily = FontFamily.Serif,
                    fontSize = 17.sp,
                    lineHeight = 31.45.sp,
                ),
        )
    }
}
