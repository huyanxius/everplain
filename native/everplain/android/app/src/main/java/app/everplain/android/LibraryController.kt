package app.everplain.android

import app.everplain.core.*
import app.everplain.shared.*
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

internal data class LibraryMaterial(
    val library: SharedKnowledgeResponse,
    val document: SharedDocumentResponse,
)

internal data class LibraryUiState(
    val libraries: List<SharedKnowledgeResponse> = emptyList(),
    val selectedId: String? = null,
    val materials: List<LibraryMaterial> = emptyList(),
    val storage: KnowledgeStorageResponse? = null,
    val imports: List<ImportBatchResponse> = emptyList(),
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val catalogError: String? = null,
    val notice: String? = null,
    val unresolved: Boolean = false,
    val source: SharedDocumentSourceResponse? = null,
    val sourceBusy: Boolean = false,
    val sourceError: String? = null,
    val saved: Long = 0,
    val canEndUpload: Boolean = false,
    val imageSources: Map<String, PersonalGraphSource> = emptyMap(),
) {
    val selected
        get() = libraries.firstOrNull { it.id == selectedId }

    val owned
        get() = libraries.filter { it.viewerAccess == "owner" }
}

@Serializable
internal data class LibraryIntent(
    val action: String,
    val key: String = newIntentKey(),
    val libraryId: String? = null,
    val documentId: String? = null,
    val body: String? = null,
    val files: List<LibraryUpload> = emptyList(),
    val validated: Boolean = false,
    val completed: Int = 0,
    val confirmedFailure: Boolean = false,
)

@Serializable
internal data class LibraryUpload(
    val path: String,
    val filename: String,
    val mime: String,
    val limit: Long,
) {
    fun snapshot() = UploadSnapshot(File(path), filename, mime, limit)
}

/** Session-scoped catalog. Read polling never invokes organize/import/model actions. */
internal class LibraryController(
    private val api: EverplainApi,
    private val scope: CoroutineScope,
    private val store: PrivateStore,
    owner: String,
    private val unauthorized: (ApiFailure) -> Unit,
) {
    private val journal = "library-intent:${api.endpoint.origin}:$owner"
    private var intent =
        store.read(journal)?.let {
            runCatching { WireJson.decodeFromString<LibraryIntent>(it) }.getOrNull()
        }
    private val mutable =
        MutableStateFlow(
            LibraryUiState(
                unresolved = intent != null,
                canEndUpload = intent?.confirmedFailure == true,
                notice = if (intent != null) "上次操作结果尚未确认。不会自动重发；可重新读取或使用原请求重试。" else null,
            )
        )
    val state = mutable.asStateFlow()
    private var closed = false
    private var visible = false
    private var loaded = false
    private var generation = 0L
    private var loadJob: Job? = null
    private var writeJob: Job? = null
    private var sourceJob: Job? = null
    private var pollJob: Job? = null
    private var sourceGeneration = 0L

    private fun update(block: (LibraryUiState) -> LibraryUiState) {
        if (!closed) mutable.update(block)
    }

    fun enter() {
        visible = true
        if (!loaded) load() else schedulePoll()
    }

    fun leave() {
        visible = false
        pollJob?.cancel()
        sourceJob?.cancel()
    }

    fun close() {
        closed = true
        generation++
        sourceGeneration++
        loadJob?.cancel()
        writeJob?.cancel()
        sourceJob?.cancel()
        pollJob?.cancel()
    }

    fun select(id: String?) {
        if (state.value.selectedId == id && loaded) return
        closeSource()
        update { it.copy(selectedId = id) }
        load()
    }

    fun dismissError() = update { it.copy(error = null, notice = null) }

    private fun handle(error: Throwable) {
        if (error is CancellationException) throw error
        if (error is ApiFailure && error.status == 401) {
            unauthorized(error)
            throw CancellationException("Session ended", error)
        }
    }

    fun load(quiet: Boolean = false) {
        loadJob?.cancel()
        pollJob?.cancel()
        val current = ++generation
        val selected = state.value.selectedId
        loadJob =
            scope.launch {
                update {
                    it.copy(
                        loading = if (quiet) it.loading else true,
                        error = null,
                        catalogError = null,
                    )
                }
                try {
                    val libraries = api.native.listSharedKnowledgeBases().items
                    val chosen = selected?.let { id -> libraries.firstOrNull { it.id == id } }
                    if (selected != null && chosen == null)
                        throw ApiFailure(404, "not_found", "知识库不存在或已无权访问")
                    val choices =
                        if (chosen != null) listOf(chosen)
                        else libraries.filter { it.viewerAccess == "owner" }
                    val details = coroutineScope {
                        choices
                            .map { item ->
                                async {
                                    try {
                                        Result.success(api.native.getSharedKnowledgeBase(item.id))
                                    } catch (e: Throwable) {
                                        handle(e)
                                        Result.failure(e)
                                    }
                                }
                            }
                            .awaitAll()
                    }
                    val successful = details.mapNotNull { it.getOrNull() }
                    val failed = details.count { it.isFailure }
                    val storage =
                        try {
                            api.native.getKnowledgeStorage()
                        } catch (e: Throwable) {
                            handle(e)
                            null
                        }
                    val imports =
                        try {
                            api.native.listImportBatches().items
                        } catch (e: Throwable) {
                            handle(e)
                            emptyList()
                        }
                    val imageSources =
                        if (
                            successful.any {
                                it.documents.orEmpty().any { document ->
                                    materialKind(document) == "图片"
                                }
                            }
                        ) {
                            try {
                                api.native.getPersonalGraph().sources.values.associateBy {
                                    "${it.libraryId}:${it.documentId}"
                                }
                            } catch (e: Throwable) {
                                handle(e)
                                emptyMap()
                            }
                        } else emptyMap()
                    if (current != generation) return@launch
                    loaded = true
                    update {
                        it.copy(
                            libraries =
                                libraries.map { item ->
                                    successful.firstOrNull { it.id == item.id } ?: item
                                },
                            materials =
                                successful.flatMap { library ->
                                    library.documents.orEmpty().map { LibraryMaterial(library, it) }
                                },
                            storage = storage,
                            imports = imports,
                            imageSources = imageSources,
                            loading = false,
                            catalogError =
                                if (failed > 0) "有 $failed 个知识库暂时无法读取，其他资料仍可查看。" else null,
                        )
                    }
                    schedulePoll()
                } catch (e: Throwable) {
                    handle(e)
                    if (current == generation)
                        update { it.copy(loading = false, error = e.message ?: "知识库读取失败") }
                }
            }
    }

    fun previewAsset(libraryId: String, documentId: String): String? {
        val raw = state.value.imageSources["$libraryId:$documentId"]?.assetUrl ?: return null
        val resolved = api.endpoint.url.resolve(raw) ?: return null
        val base = api.endpoint.url
        if (
            resolved.scheme != base.scheme ||
                resolved.host != base.host ||
                resolved.port != base.port ||
                resolved.username.isNotEmpty() ||
                resolved.password.isNotEmpty() ||
                resolved.query != null ||
                resolved.fragment != null
        )
            return null
        val id =
            resolved.pathSegments
                .takeIf { it.size == 4 && it.take(3) == listOf("api", "imports", "assets") }
                ?.last() ?: return null
        return runCatching { java.util.UUID.fromString(id).toString() }.getOrNull()
    }

    suspend fun imagePreview(asset: String): BinaryPayload =
        try {
            api.imageAsset(asset)
        } catch (e: Throwable) {
            handle(e)
            throw e
        }

    private fun schedulePoll() {
        pollJob?.cancel()
        if (
            !visible ||
                closed ||
                !state.value.materials.any { isMaterialProcessing(it.document) } &&
                    !state.value.imports.any { it.status == "processing" }
        )
            return
        pollJob =
            scope.launch {
                delay(3000)
                if (visible) load(quiet = true)
            }
    }

    fun source(libraryId: String, documentId: String, segmentId: String? = null) {
        sourceJob?.cancel()
        val current = ++sourceGeneration
        update { it.copy(source = null, sourceBusy = true, sourceError = null) }
        sourceJob =
            scope.launch {
                try {
                    val result =
                        api.native.getSharedDocumentSource(libraryId, documentId, segmentId)
                    if (current == sourceGeneration)
                        update { it.copy(source = result, sourceBusy = false) }
                } catch (e: Throwable) {
                    handle(e)
                    if (current == sourceGeneration)
                        update {
                            it.copy(sourceBusy = false, sourceError = e.message ?: "原文暂时无法读取")
                        }
                }
            }
    }

    fun closeSource() {
        sourceGeneration++
        sourceJob?.cancel()
        update { it.copy(source = null, sourceBusy = false, sourceError = null) }
    }

    fun saveLibrary(id: String?, name: String, description: String) {
        if (name.trim().isEmpty() || name.length > 100 || description.length > 1000) return
        if (id == null)
            submit(
                LibraryIntent(
                    "create",
                    body =
                        WireJson.encodeToString(
                            CreateSharedKnowledgeRequest(description.trim(), name.trim())
                        ),
                )
            )
        else
            submit(
                LibraryIntent(
                    "update",
                    libraryId = id,
                    body =
                        WireJson.encodeToString(
                            UpdateSharedKnowledgeRequest(description.trim(), name.trim())
                        ),
                )
            )
    }

    fun deleteLibrary(id: String) = submit(LibraryIntent("delete", libraryId = id))

    fun detach(libraryId: String, documentId: String) =
        submit(LibraryIntent("detach", libraryId = libraryId, documentId = documentId))

    fun organize(libraryId: String, documentId: String) =
        submit(LibraryIntent("organize", libraryId = libraryId, documentId = documentId))

    fun sharing(id: String, enabled: Boolean) =
        submit(
            LibraryIntent(
                "update",
                libraryId = id,
                body =
                    WireJson.encodeToString(UpdateSharedKnowledgeRequest(sharingEnabled = enabled)),
            )
        )

    fun join(token: String) {
        if (token.isNotBlank())
            submit(
                LibraryIntent(
                    "join",
                    body = WireJson.encodeToString(JoinSharedKnowledgeRequest(token.trim())),
                )
            )
    }

    fun leaveShared(id: String) = submit(LibraryIntent("leave", libraryId = id))

    fun publish(
        id: String,
        title: String,
        description: String,
        topics: List<String>,
        confirmed: Boolean,
    ) {
        if (!confirmed || title.isBlank()) return
        submit(
            LibraryIntent(
                "publish",
                libraryId = id,
                body =
                    WireJson.encodeToString(
                        PublishKnowledgeRequest(true, description, title, topics)
                    ),
            )
        )
    }

    fun unpublish(id: String) = submit(LibraryIntent("unpublish", libraryId = id))

    fun upload(id: String?, files: List<LibraryUpload>) {
        if (files.isNotEmpty()) submit(LibraryIntent("upload", libraryId = id, files = files))
    }

    fun importFiles(source: String, files: List<LibraryUpload>) =
        submit(LibraryIntent("import", body = source, files = files))

    fun importBilibili(uid: String) {
        if (!Regex("[0-9]{1,20}").matches(uid)) return
        submit(
            LibraryIntent(
                "bilibili",
                body = WireJson.encodeToString(BilibiliImportRequest(uid = uid)),
            )
        )
    }

    fun retryImport(batch: String, item: String) =
        submit(LibraryIntent("retry-import", libraryId = batch, documentId = item))

    private fun submit(value: LibraryIntent) {
        if (closed || state.value.busy) return
        if (intent != null) {
            update { it.copy(error = "请先核对上次结果，或使用原请求重试。") }
            return
        }
        try {
            store.write(journal, WireJson.encodeToString(value))
            intent = value
        } catch (e: Throwable) {
            update { it.copy(error = "无法安全记录本次操作，请稍后再试。") }
            return
        }
        execute(value)
    }

    /** Explicit only: retries the exact durable request/key, never a replacement payload. */
    fun retryOriginal() {
        if (!state.value.busy) intent?.let(::execute)
    }

    private fun execute(value: LibraryIntent) {
        if (closed) return
        if (value.confirmedFailure) checkpoint(value.copy(confirmedFailure = false))
        update {
            it.copy(
                busy = true,
                error = null,
                notice = null,
                unresolved = true,
                canEndUpload = false,
            )
        }
        val startingSelection = state.value.selectedId
        writeJob =
            scope.launch {
                try {
                    when (value.action) {
                        "create" -> {
                            val result =
                                api.native.createSharedKnowledgeBase(
                                    value.key,
                                    WireJson.decodeFromString(value.body!!),
                                )
                            if (state.value.selectedId == startingSelection)
                                update { it.copy(selectedId = result.id) }
                        }
                        "update" ->
                            api.native.updateSharedKnowledgeBase(
                                value.libraryId!!,
                                value.key,
                                WireJson.decodeFromString(value.body!!),
                            )
                        "delete" -> {
                            api.native.deleteSharedKnowledgeBase(value.libraryId!!, value.key)
                            if (state.value.selectedId == value.libraryId)
                                update { it.copy(selectedId = null) }
                        }
                        "detach" ->
                            api.native.detachSharedDocument(
                                value.libraryId!!,
                                value.documentId!!,
                                value.key,
                            )
                        "organize" ->
                            api.native.organizeSharedDocument(
                                value.libraryId!!,
                                value.documentId!!,
                                value.key,
                            )
                        "join" -> {
                            val result =
                                api.native.joinSharedKnowledgeBase(
                                    value.key,
                                    WireJson.decodeFromString(value.body!!),
                                )
                            if (state.value.selectedId == startingSelection)
                                update { it.copy(selectedId = result.knowledgeBaseId) }
                        }
                        "leave" -> {
                            api.native.leaveSharedKnowledgeBase(value.libraryId!!, value.key)
                            if (state.value.selectedId == value.libraryId)
                                update { it.copy(selectedId = null) }
                        }
                        "publish" ->
                            api.native.publishKnowledgeMetadata(
                                value.libraryId!!,
                                value.key,
                                WireJson.decodeFromString(value.body!!),
                            )
                        "unpublish" ->
                            api.native.unpublishKnowledgeMetadata(value.libraryId!!, value.key)
                        "upload" -> executeUploads(value)
                        "import" -> {
                            validateImport(value)
                            api.importFiles(
                                value.body!!,
                                value.files.map { it.snapshot() },
                                value.key,
                            )
                        }
                        "bilibili" ->
                            api.native.createBilibiliImport(
                                value.key,
                                WireJson.decodeFromString(value.body!!),
                            )
                        "retry-import" ->
                            api.native.retryImportItem(
                                value.libraryId!!,
                                value.documentId!!,
                                value.key,
                            )
                        else -> error("无法识别保留的操作")
                    }
                    store.write(journal, null)
                    intent = null
                    value.files.forEach { runCatching { File(it.path).delete() } }
                    update {
                        it.copy(
                            busy = false,
                            unresolved = false,
                            saved = it.saved + 1,
                            notice = "已保存。",
                        )
                    }
                    load(quiet = true)
                } catch (e: Throwable) {
                    handle(e)
                    val definite =
                        (e is ApiFailure && e.status in 400..499 && e.status != 408) ||
                            e is IllegalArgumentException
                    val partial = value.action == "upload" && (intent?.completed ?: 0) > 0
                    if (definite && partial) checkpoint(intent!!.copy(confirmedFailure = true))
                    else if (definite) {
                        store.write(journal, null)
                        intent = null
                    }
                    update {
                        it.copy(
                            busy = false,
                            unresolved = !definite || partial,
                            canEndUpload = definite && partial,
                            error = e.message ?: "操作未完成",
                            notice = if (definite) null else "结果尚未确认。原请求已保留，不会自动重发。",
                        )
                    }
                }
            }
    }

    fun endRejectedUpload() {
        val old = intent ?: return
        if (!old.confirmedFailure || state.value.busy) return
        store.write(journal, null)
        intent = null
        old.files.forEach { File(it.path).delete() }
        update {
            it.copy(
                unresolved = false,
                canEndUpload = false,
                error = null,
                notice = "已上传的资料已保留，剩余文件未继续上传。",
                saved = it.saved + 1,
            )
        }
    }

    private fun checkpoint(value: LibraryIntent) {
        store.write(journal, WireJson.encodeToString(value))
        intent = value
    }

    private suspend fun executeUploads(original: LibraryIntent) {
        var value = original.copy(confirmedFailure = false)
        if (!value.validated) {
            val limits = api.native.getKnowledgeStorage()
            val total = value.files.sumOf { File(it.path).length() }
            require(limits.usedBytes + total <= limits.maxBytes) { "存储空间不足，请先整理已有资料。" }
            require(
                value.files.all {
                    File(it.path).isFile && File(it.path).length() <= limits.maxFileBytes
                }
            ) {
                "单份资料超过服务器允许的大小，或本机文件已不可用。"
            }
            val selected = value.libraryId?.let { api.native.getSharedKnowledgeBase(it) }
            require(selected == null || selected.viewerAccess == "owner") { "此知识库为只读，不能上传资料。" }
            require(
                (selected?.documents?.size ?: 0) + value.files.size <= limits.maxDocumentsPerLibrary
            ) {
                "所选资料超过知识库可用位置。"
            }
            require(selected != null || limits.libraryCount < limits.maxLibraries) { "已达到知识库数量上限。" }
            value = value.copy(validated = true)
            checkpoint(value)
        }
        if (value.libraryId == null) {
            val library =
                api.native.createSharedKnowledgeBase(
                    value.key + "-library",
                    CreateSharedKnowledgeRequest("", "我的资料"),
                )
            value = value.copy(libraryId = library.id)
            checkpoint(value)
        }
        for (index in value.completed until value.files.size) {
            ensureActiveScope()
            update {
                it.copy(
                    notice = "正在上传 ${index+1}/${value.files.size}：${value.files[index].filename}"
                )
            }
            api.uploadLibraryDocument(
                value.libraryId!!,
                value.files[index].snapshot(),
                value.key + "-$index",
            )
            value = value.copy(completed = index + 1)
            checkpoint(value)
        }
    }

    private fun ensureActiveScope() {
        if (closed) throw CancellationException("Session ended")
    }

    private suspend fun validateImport(value: LibraryIntent) {
        if (value.validated) return
        val limits = api.native.getKnowledgeStorage()
        require(
            value.files.all { File(it.path).isFile && File(it.path).length() <= 16L * 1024 * 1024 }
        ) {
            "单个导入文件不能超过 16 MB。"
        }
        val total = value.files.sumOf { File(it.path).length() }
        require(total <= 64L * 1024 * 1024) { "单次导入不能超过 64 MB。" }
        require(limits.usedBytes + total <= limits.maxBytes) { "存储空间不足。" }
        checkpoint(value.copy(validated = true))
    }
}

internal fun materialKind(document: SharedDocumentResponse): String {
    val extension = document.filename.substringAfterLast('.', "").lowercase()
    return when {
        extension == "pdf" || document.mediaType == "application/pdf" -> "PDF"
        extension == "docx" -> "Word"
        extension == "pptx" -> "演示文稿"
        document.mediaType.startsWith("image/") -> "图片"
        extension in setOf("html", "htm") -> "网页"
        else -> "笔记"
    }
}

internal fun isMaterialProcessing(document: SharedDocumentResponse) =
    document.status == "processing" ||
        (document.status == "ready" &&
            listOf(document.knowledgeStatus, document.indexStatus).any {
                it in setOf("queued", "running")
            })
