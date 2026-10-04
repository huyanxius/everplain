package app.everplain.core

import app.everplain.shared.*
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

val WireJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

class ApiFailure(val status: Int, val code: String?, message: String) : IOException(message)

class StreamDisconnected : IOException("连接在回答完成前中断。可恢复原来的回答。")

fun newIntentKey(): String = UUID.randomUUID().toString()

/**
 * Open transport seam supports instrumented test doubles; production constructs this real client.
 */
open class EverplainApi(val endpoint: Endpoint, private val store: PrivateStore) {
    private val cookies = SessionCookies(endpoint.url, store)
    private val client =
        OkHttpClient.Builder()
            .cookieJar(cookies)
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()

    val native: NativeOperations by lazy { NativeOperations(this) }

    /** Shared typed contracts use the same private cookie jar and cancellation-aware transport. */
    open suspend fun <T> contractJson(
        serializer: kotlinx.serialization.DeserializationStrategy<T>,
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): T =
        exchange(contractRequest(path, method, body, key, query)) {
            if (!it.isSuccessful) throw failure(it)
            WireJson.decodeFromString(serializer, it.body?.string() ?: throw IOException("服务未返回数据"))
        }

    open suspend fun contractUnit(
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ) {
        exchange(contractRequest(path, method, body, key, query)) {
            if (!it.isSuccessful) throw failure(it)
        }
    }

    private fun contractRequest(
        path: String,
        method: String,
        body: String?,
        key: String?,
        query: Map<String, List<String>?>,
    ): Request {
        val url =
            endpoint
                .path(path)
                .newBuilder()
                .apply {
                    query.forEach { (name, values) ->
                        values?.forEach { addQueryParameter(name, it) }
                    }
                }
                .build()
        return request(path, method, body, key).newBuilder().url(url).build()
    }

    fun clearLocalSession() {
        cookies.clear()
    }

    private fun request(
        path: String,
        method: String,
        body: String?,
        key: String? = null,
        stream: Boolean = false,
    ): Request =
        Request.Builder()
            .url(endpoint.path(path))
            .header("Accept", if (stream) "text/event-stream" else "application/json")
            .apply { if (key != null) header("Idempotency-Key", key) }
            .method(
                method,
                if (method == "GET") null
                else (body ?: "").toRequestBody("application/json; charset=utf-8".toMediaType()),
            )
            .build()

    private suspend fun <T> exchange(request: Request, read: (Response) -> T): T =
        withContext(Dispatchers.IO) {
            val call = client.newCall(request)
            // Cancellation must close a slow body too, not only an outstanding header wait.
            val closer =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    try {
                        awaitCancellation()
                    } finally {
                        call.cancel()
                    }
                }
            try {
                call.execute().use(read)
            } catch (error: IOException) {
                currentCoroutineContext().ensureActive()
                throw error
            } finally {
                closer.cancel()
            }
        }

    private fun failure(response: Response): ApiFailure {
        val text = response.peekBody(65_536).string()
        val obj = runCatching { WireJson.parseToJsonElement(text.orEmpty()).jsonObject }.getOrNull()
        val error = obj?.get("error") as? JsonObject
        val message =
            (error?.get("message") as? JsonPrimitive)?.contentOrNull
                ?: (obj?.get("detail") as? JsonPrimitive)?.contentOrNull
                ?: when (response.code) {
                    401 -> "登录已过期，请重新登录"
                    403 -> "当前账号无权访问"
                    409 -> "内容已在其他设备更新，请先核对最新版本"
                    429 -> "请求过于频繁，请稍后重试"
                    else -> "服务请求失败（${response.code}）"
                }
        return ApiFailure(
            response.code,
            (error?.get("code") as? JsonPrimitive)?.contentOrNull,
            message,
        )
    }

    private suspend inline fun <reified T> json(
        path: String,
        method: String = "GET",
        body: String? = null,
        key: String? = null,
    ): T =
        exchange(request(path, method, body, key)) {
            if (!it.isSuccessful) throw failure(it)
            WireJson.decodeFromString<T>(it.body?.string() ?: throw IOException("服务未返回数据"))
        }

    open suspend fun uploadLibraryDocument(libraryId: String, file: UploadSnapshot, key: String): SharedDocumentResponse {
        val body=MultipartBody.Builder(multipartBoundary(key)).setType(MultipartBody.FORM)
            .addFormDataPart("file",file.filename,file.body()).build()
        return multipart("/api/shared-knowledge-bases/${UUID.fromString(libraryId)}/documents",body,key,SharedDocumentResponse.serializer())
    }

    open suspend fun importFiles(sourceType: String, files: List<UploadSnapshot>, key: String, libraryId: String?=null): ImportBatchResponse {
        require(sourceType in setOf("chrome","markdown","obsidian","enex","notion","flomo","keep","apple_notes","image"))
        require(files.isNotEmpty())
        val body=MultipartBody.Builder(multipartBoundary(key)).setType(MultipartBody.FORM).addFormDataPart("source_type",sourceType)
            .apply {
                if(libraryId!=null)addFormDataPart("library_id",UUID.fromString(libraryId).toString())
                files.forEach { addFormDataPart("files",it.filename,it.body()) }
            }.build()
        return multipart(EverplainEndpoint.createImportBatch,body,key,ImportBatchResponse.serializer())
    }

    private suspend fun <T> multipart(path:String,body:MultipartBody,key:String,serializer:kotlinx.serialization.DeserializationStrategy<T>):T =
        exchange(request(path,"POST",null,key).newBuilder().post(body).build()) {
            if(!it.isSuccessful)throw failure(it)
            WireJson.decodeFromString(serializer,it.body?.string() ?: throw IOException("服务未返回数据"))
        }

    open suspend fun imageAsset(documentId:String,maxBytes:Long=32L*1024*1024):BinaryPayload =
        binary("/api/imports/assets/${UUID.fromString(documentId)}",maxBytes=maxBytes,accept="image/*")

    open suspend fun materialContent(taskId:String,materialId:String,range:String?=null,maxBytes:Long):BinaryPayload =
        binary("/api/research-tasks/${UUID.fromString(taskId)}/materials/${UUID.fromString(materialId)}/content",range,maxBytes,"*/*")

    private suspend fun binary(path:String,range:String?=null,maxBytes:Long,accept:String):BinaryPayload {
        require(maxBytes in 1..Int.MAX_VALUE.toLong())
        require(range==null || Regex("bytes=(?:[0-9]+-[0-9]*|-[0-9]+)").matches(range))
        val request=request(path,"GET",null).newBuilder().header("Accept",accept).apply { if(range!=null)header("Range",range) }.build()
        return exchange(request) { response ->
            if(!response.isSuccessful)throw failure(response)
            val body=response.body ?: throw IOException("服务未返回文件")
            if(body.contentLength()>maxBytes)throw IOException("文件超过本机读取上限")
            val output=java.io.ByteArrayOutputStream()
            body.byteStream().use { input ->
                val buffer=ByteArray(32*1024);var total=0L
                while(true) { val n=input.read(buffer);if(n<0)break;total+=n;if(total>maxBytes)throw IOException("文件超过本机读取上限");output.write(buffer,0,n) }
            }
            BinaryPayload(output.toByteArray(),body.contentType()?.toString(),response.header("Content-Range"),response.code)
        }
    }

    open suspend fun session(): SessionResponse = json(EverplainEndpoint.getCurrentSession)

    open suspend fun login(email: String, password: String): SessionResponse =
        json(
            EverplainEndpoint.loginSession,
            "POST",
            WireJson.encodeToString(LoginSessionRequest(email, password)),
            newIntentKey(),
        )

    open suspend fun sendRegistrationCode(email: String): RegistrationCodeResponse =
        json(
            EverplainEndpoint.sendRegistrationCode,
            "POST",
            WireJson.encodeToString(RegistrationCodeRequest(email)),
            newIntentKey(),
        )

    open suspend fun register(email: String, password: String, code: String): SessionResponse =
        json(
            EverplainEndpoint.registerSession,
            "POST",
            WireJson.encodeToString(
                RegisterSessionRequest(email = email, password = password, verificationCode = code)
            ),
            newIntentKey(),
        )

    open suspend fun logout(): LogoutSessionResponse =
        json(EverplainEndpoint.logoutSession, "POST", key = newIntentKey())

    open suspend fun models(): AgentModelCatalogResponse = json(EverplainEndpoint.listAgentModels)

    open suspend fun profile(): AgentProfileResponse = json(EverplainEndpoint.getAgentProfile)

    open suspend fun updateProfile(update: AgentProfileUpdate, key: String): AgentProfileResponse =
        json(EverplainEndpoint.updateAgentProfile, "PATCH", WireJson.encodeToString(update), key)

    open suspend fun history(): List<AgentConversationSummaryResponse> =
        json<AgentConversationListResponse>(EverplainEndpoint.listAgentConversations).items.filter {
            it.taskId == null && it.referenceKnowledgeBaseId == null
        }

    open suspend fun conversation(id: String): AgentConversationResponse =
        json("/api/agent/conversations/${UUID.fromString(id)}")

    open suspend fun lookupRun(key: String): AgentRunLookupResponse =
        json(EverplainEndpoint.lookupAgentRun, key = key)

    open suspend fun account(): AccountResponse = json(EverplainEndpoint.getAccount)

    open suspend fun updateAccountName(body: UpdateProfileRequest, key: String): AccountResponse =
        json(EverplainEndpoint.updateAccountProfile, "PATCH", WireJson.encodeToString(body), key)

    open suspend fun credits(): CreditSummaryResponse = json(EverplainEndpoint.getAccountCredits)

    open suspend fun sessions(): AccountSessionPageResponse =
        json(EverplainEndpoint.listAccountSessions)

    open suspend fun stop(id: String, key: String): AgentRunStopResponse =
        exchange(request("/api/agent/runs/${UUID.fromString(id)}/stop", "POST", null, key)) {
            if (!it.isSuccessful) throw failure(it)
            if (it.code == 204) AgentRunStopResponse(true, id, "interrupted")
            else WireJson.decodeFromString(it.body!!.string())
        }

    open fun stream(body: AgentTurnRequest, key: String): Flow<SseFrame> =
        flow {
                val call =
                    client.newCall(
                        request(
                            EverplainEndpoint.streamAgentTurn,
                            "POST",
                            WireJson.encodeToString(body),
                            key,
                            true,
                        )
                    )
                val closer =
                    CoroutineScope(currentCoroutineContext()).launch(
                        Dispatchers.IO,
                        CoroutineStart.UNDISPATCHED,
                    ) {
                        try {
                            awaitCancellation()
                        } finally {
                            call.cancel()
                        }
                    }
                try {
                    call.execute().use { response ->
                        if (!response.isSuccessful) throw failure(response)
                        if (
                            response.body?.contentType()?.let {
                                it.type == "text" && it.subtype == "event-stream"
                            } != true
                        )
                            throw IOException("服务返回了非流式响应")
                        val source = response.body!!.source()
                        val parser = SseDecoder()
                        val buffer = ByteArray(8192)
                        var terminal = false
                        readLoop@ while (true) {
                            currentCoroutineContext().ensureActive()
                            val count = source.read(buffer)
                            if (count < 0) break
                            for (event in parser.feed(buffer.copyOf(count))) {
                                emit(event)
                                if (
                                    event.event in
                                        setOf(
                                            "turn_completed",
                                            "turn_interrupted",
                                            "turn_failed",
                                            "research_waiting",
                                        )
                                ) {
                                    terminal = true
                                    break@readLoop
                                }
                            }
                        }
                        if (!terminal) throw StreamDisconnected()
                    }
                } catch (error: IOException) {
                    // OkHttp reports cancelled reads as IOException; keep coroutine cancellation
                    // terminal so it cannot surface as a user-visible network error or orphan
                    // child.
                    currentCoroutineContext().ensureActive()
                    throw error
                } finally {
                    closer.cancel()
                    call.cancel()
                }
            }
            .flowOn(Dispatchers.IO)
}
