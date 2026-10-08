package app.everplain.android

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.JavaScriptSandbox
import app.everplain.core.WireJson
import app.everplain.shared.EverplainTokens
import com.google.common.util.concurrent.Futures
import kotlinx.coroutines.*
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

@Serializable private data class NativeDiffInput(val base: String, val proposed: String)

/**
 * One connection process-wide. Each bounded calculation owns and closes its isolate and sandbox.
 */
internal object NativeDocumentDiff {
    private val gate = Mutex()

    suspend fun compute(context: Context, base: String, proposed: String): List<NativeDiffPart> =
        gate.withLock {
            require(base.length <= 200000 && proposed.length <= 200000) { "文稿章节超过差异计算上限。" }
            check(JavaScriptSandbox.isSupported()) {
                "当前系统未提供安全脚本计算引擎，请更新 Android System WebView 后重试。"
            }
            withTimeout(20000) {
                val future =
                    JavaScriptSandbox.createConnectedInstanceAsync(context.applicationContext)
                // If cancellation wins the connection race, close a successfully delivered
                // resource.
                var adopted = false
                try {
                    val sandbox = Futures.nonCancellationPropagating(future).await()
                    adopted = true
                    sandbox.use {
                        val required =
                            listOf(
                                JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,
                                JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN,
                                JavaScriptSandbox.JS_FEATURE_ISOLATE_TERMINATION,
                                JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE,
                                JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT,
                            )
                        check(required.all(sandbox::isFeatureSupported)) {
                            "系统计算引擎缺少所需隔离能力，请更新后重试。"
                        }
                        val options =
                            IsolateStartupParameters().apply {
                                setMaxHeapSizeBytes(64L * 1024 * 1024)
                                setMaxEvaluationReturnSizeBytes(4 * 1024 * 1024)
                            }
                        sandbox.createIsolate(options).use { isolate ->
                            val scripts =
                                withContext(Dispatchers.IO) {
                                    listOf("web-document-diff.js", "runtime-envelope.js").map {
                                        filename ->
                                        context.assets
                                            .open("document-diff/$filename")
                                            .bufferedReader()
                                            .use { it.readText() }
                                    }
                                }
                            isolate.evaluateJavaScriptAsync(scripts[0] + ";'ready'").await()
                            isolate.provideNamedData(
                                "request",
                                WireJson.encodeToString(NativeDiffInput(base, proposed))
                                    .toByteArray(Charsets.UTF_8),
                            )
                            val result = isolate.evaluateJavaScriptAsync(scripts[1]).await()
                            WireJson.decodeFromString<List<NativeDiffPart>>(result).also { parts ->
                                check(
                                    parts.all {
                                        it.kind in setOf("unchanged", "deleted", "inserted")
                                    }
                                )
                            }
                        }
                    }
                } finally {
                    if (!adopted)
                        withContext(NonCancellable) {
                            // Keep the process-wide lock until a cancelled connection is closed. A
                            // new
                            // screen must not race an in-flight bind with a second sandbox
                            // connection.
                            val orphan =
                                withTimeoutOrNull(10000) {
                                    runCatching {
                                            Futures.nonCancellationPropagating(future).await()
                                        }
                                        .getOrNull()
                                }
                            if (orphan != null) orphan.close() else future.cancel(true)
                        }
                }
            }
        }
}

@Composable
internal fun NativeDocumentDifference(context: Context, base: String, proposed: String) {
    var parts by remember(base, proposed) { mutableStateOf<List<NativeDiffPart>?>(null) }
    var error by remember(base, proposed) { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(base, proposed, retry) {
        error = null
        try {
            parts = NativeDocumentDiff.compute(context, base, proposed)
        } catch (e: TimeoutCancellationException) {
            error = "文稿差异计算超时，请重试。"
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: "文稿差异暂时无法计算。"
        }
    }
    Column {
        error?.let { LibraryNotice(it, true, "重新计算差异", { retry++ }) }
        parts?.let { values ->
            val ink = MaterialTheme.colorScheme.onSurface
            val danger = MaterialTheme.colorScheme.error
            val info =
                EverplainTokens.colorInfo(MaterialTheme.colorScheme.background.luminance() < .5f)
                    .compose()
            val text = buildAnnotatedString {
                displayDiffParts(values).forEach { part ->
                    withStyle(
                        SpanStyle(
                            color =
                                when (part.kind) {
                                    "deleted" -> danger
                                    "inserted" -> info
                                    else -> ink
                                },
                            textDecoration =
                                if (part.kind == "deleted") TextDecoration.LineThrough
                                else TextDecoration.None,
                        )
                    ) {
                        append(part.text)
                    }
                }
            }
            SelectionContainer {
                Text(
                    text,
                    style =
                        MaterialTheme.typography.bodyMedium.copy(
                            fontFamily = FontFamily.Serif,
                            fontSize = EverplainTokens.textControl.sp,
                            lineHeight =
                                (EverplainTokens.textControl * EverplainTokens.textBodyLineHeight)
                                    .sp,
                        ),
                )
            }
        }
        if (parts == null && error == null)
            Text("正在比较局部修改…", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
    }
}
