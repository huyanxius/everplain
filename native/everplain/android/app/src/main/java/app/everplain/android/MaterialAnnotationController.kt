package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

@Serializable
internal data class MaterialSelection(
    val segment: ResearchMaterialSegmentResponse,
    val quote: String,
    val start: Long,
    val end: Long,
)

/**
 * Android selection offsets are UTF16; backend immutable-segment offsets are Unicode codepoints.
 */
internal fun materialSelection(
    segment: ResearchMaterialSegmentResponse,
    start: Int,
    end: Int,
): MaterialSelection? {
    val text = segment.text
    if (start < 0 || end > text.length || end <= start) return null
    if (
        (start > 0 && text[start].isLowSurrogate() && text[start - 1].isHighSurrogate()) ||
            (end < text.length && text[end].isLowSurrogate() && text[end - 1].isHighSurrogate())
    )
        return null
    val raw = text.substring(start, end)
    val quote = raw.trim { it.isWhitespace() || it == '\uFEFF' }
    if (quote.isEmpty()) return null
    val from = start + raw.indexOf(quote)
    val to = from + quote.length
    return MaterialSelection(
        segment,
        quote,
        text.codePointCount(0, from).toLong(),
        text.codePointCount(0, to).toLong(),
    )
}

@Serializable
internal data class MaterialAnnotationDraft(
    val selection: MaterialSelection,
    val kind: String = "descriptive",
    val note: String = "",
    val reflection: String = "",
    val caseLabel: String = "",
    val observedAt: String = "",
) {
    val ready
        get() =
            kind in setOf("descriptive", "researcher_reflection") &&
                note.isNotBlank() &&
                (kind != "researcher_reflection" || reflection.isNotBlank())

    fun request() =
        CreateAnalysisAnnotationRequest(
            kind,
            caseLabel.trim().takeIf { it.isNotBlank() },
            selection.segment.materialId,
            note.trim(),
            observedAt.trim().takeIf { it.isNotBlank() },
            selection.segment.parseId,
            selection.end,
            selection.start,
            reflection.trim().takeIf { it.isNotBlank() },
            selection.segment.segmentId,
        )
}

@Serializable
private data class AnnotationIntent(
    val draft: MaterialAnnotationDraft,
    val key: String = newIntentKey(),
)

internal data class MaterialAnnotationState(
    val draft: MaterialAnnotationDraft? = null,
    val open: Boolean = false,
    val busy: Boolean = false,
    val unknown: Boolean = false,
    val error: String? = null,
    val saved: AnalysisAnnotationResponse? = null,
)

/** A project/owner-scoped original-intent journal; opening a reader never creates an annotation. */
internal class MaterialAnnotationController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    val taskId: String,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val prefix = "material-annotation:${api.endpoint.origin}:$owner:$taskId"
    private var intent =
        store.read("$prefix:intent")?.let {
            runCatching { WireJson.decodeFromString<AnnotationIntent>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(
            MaterialAnnotationState(
                draft =
                    store.read("$prefix:draft")?.let {
                        runCatching { WireJson.decodeFromString<MaterialAnnotationDraft>(it) }
                            .getOrNull()
                    },
                unknown = intent != null,
            )
        )
    val state = mutable.asStateFlow()
    private var closed = false
    private var writer: Job? = null

    private fun update(block: (MaterialAnnotationState) -> MaterialAnnotationState) {
        if (!closed) mutable.update(block)
    }

    fun close() {
        closed = true
        writer?.cancel()
    }

    fun hide() {
        update { it.copy(open = false) }
    }

    fun reopen() {
        if (state.value.draft != null) update { it.copy(open = true) }
    }

    fun select(value: MaterialSelection) {
        if (closed || state.value.busy) return
        if (intent != null) {
            update { it.copy(open = true, error = "上一条标记的结果尚未确认，原片段与草稿仍保留。请先恢复原操作。") }
            return
        }
        val next = MaterialAnnotationDraft(value)
        store.write("$prefix:draft", WireJson.encodeToString(next))
        update { it.copy(draft = next, open = true, error = null, saved = null) }
    }

    fun edit(change: (MaterialAnnotationDraft) -> MaterialAnnotationDraft) {
        val current = state.value.draft ?: return
        if (closed) return
        val next = change(current)
        store.write("$prefix:draft", WireJson.encodeToString(next))
        update { it.copy(draft = next, error = null) }
    }

    fun save() {
        val draft = state.value.draft ?: return
        if (closed || state.value.busy || intent != null || !draft.ready) return
        val next = AnnotationIntent(draft)
        store.write("$prefix:intent", WireJson.encodeToString(next))
        intent = next
        execute(next)
    }

    fun retry() {
        intent?.let(::execute)
    }

    private fun execute(request: AnnotationIntent) {
        if (closed || state.value.busy) return
        update { it.copy(busy = true, error = null) }
        writer =
            scope.launch {
                try {
                    val result =
                        api.native.createResearchAnalysisAnnotation(
                            taskId,
                            request.key,
                            request.draft.request(),
                        )
                    if (closed) return@launch
                    store.write("$prefix:intent", null)
                    intent = null
                    val unchanged = state.value.draft == request.draft
                    if (unchanged) store.write("$prefix:draft", null)
                    update {
                        it.copy(
                            saved = result,
                            unknown = false,
                            draft = if (unchanged) null else it.draft,
                            open = !unchanged,
                        )
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val f = e as? ApiFailure
                    if (f?.status == 401) unauthorized(f)
                    if (f != null && f.status in 400..499 && f.status !in setOf(408, 409, 429)) {
                        store.write("$prefix:intent", null)
                        intent = null
                    }
                    update { it.copy(error = e.message ?: "片段标记未保存。", unknown = intent != null) }
                } finally {
                    update { it.copy(busy = false) }
                }
            }
    }
}
