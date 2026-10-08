package app.everplain.android

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

@Serializable
private data class ResearchStartIntent(val key: String, val request: ConfirmResearchStartRequest)

@Serializable data class SavedSelection(val modelId: String, val effort: String)

@Serializable
data class PendingTurn(
    val owner: String,
    val key: String,
    val request: AgentTurnRequest,
    val runId: String? = null,
    val conversationId: String? = request.conversationId,
    val partial: String = "",
    val stopKey: String? = null,
    val outcomeConfirmed: Boolean = false,
    val origin: String = "",
    val signals: NativeTurnSignals = NativeTurnSignals(),
)

enum class Destination {
    Home,
    Chat,
    History,
    Account,
    Agent,
    Memory,
    Library,
    Graph,
    Files,
    Research,
    ResearchLaunch,
}

data class AppState(
    val appearance: String = "system",
    val origin: String = "https://e.qunxue.xyz",
    val registrationEmail: String? = null,
    val registrationCodeDraft: String = "",
    val registrationCodeSequence: Long = 0,
    val registrationResendUntil: Long = 0,
    val starting: Boolean = true,
    val busy: Boolean = false,
    val session: SessionResponse? = null,
    val destination: Destination = Destination.Home,
    val profile: AgentProfileResponse? = null,
    val catalog: AgentModelCatalogResponse? = null,
    val model: String? = null,
    val effort: String? = null,
    val history: List<AgentConversationSummaryResponse> = emptyList(),
    val conversation: AgentConversationResponse? = null,
    val turnKeys: Map<String, String> = emptyMap(),
    val pending: PendingTurn? = null,
    val recoveries: List<PendingTurn> = emptyList(),
    val streaming: Boolean = false,
    val stopping: Boolean = false,
    val status: String? = null,
    val account: AccountResponse? = null,
    val credits: CreditSummaryResponse? = null,
    val subscription: SubscriptionOverviewResponse? = null,
    val accountMenuLoading: Boolean = false,
    val planUnavailable: Boolean = false,
    val usageUnavailable: Boolean = false,
    val accountSection: String = "个人资料",
    val sessions: List<AccountSessionResponse> = emptyList(),
    val error: String? = null,
    val settingsConflict: Boolean = false,
    val settingsConflictReady: Boolean = false,
    val settingsSaved: Long = 0,
    val draft: String = "",
    val referenceLibraryId: String? = null,
    val composerMode: String = "standard",
    val turnSignals: Map<String, NativeTurnSignals> = emptyMap(),
    val researchPanel: Boolean = false,
    val materialScope: String = newIntentKey(),
    val materialContext: AgentMaterialContextResponse? = null,
    val workspaceTask: String? = null,
    val selectedCitation: AgentCitationResponse? = null,
    val journey: AgentResearchJourneyResponse? = null,
    val journeyError: String? = null,
    val journeyBusy: Boolean = false,
    val webSearch: Boolean = true,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val store = EncryptedStore(application)
    private val mutable =
        MutableStateFlow(
            AppState(
                origin = store.read("origin") ?: "https://e.qunxue.xyz",
                appearance = store.read("appearance") ?: "system",
            )
        )
    val state = mutable.asStateFlow()
    private var api: EverplainApi? = null
    private var streamJob: Job? = null
    private var generation = 0L
    private var sessionOwner: String? = null
    private var refreshJob: Job? = null
    private var stopJob: Job? = null
    private var profileIntent: Pair<AgentProfileUpdate, String>? = null
    private var accountIntent: Pair<UpdateProfileRequest, String>? = null

    private var agentSettingsDraft: AgentSettingsDraft? = null
    private var agentSettingsDraftOwner: String? = null

    internal fun agentDraft(profile: AgentProfileResponse): AgentSettingsDraft {
        val owner = "${state.value.origin}:${sessionOwner ?: error("尚未登录") }"
        if (agentSettingsDraftOwner != owner || agentSettingsDraft == null) {
            val key = "agent-settings-draft:$owner"
            val saved =
                store.read(key)?.let {
                    runCatching { WireJson.decodeFromString<AgentDraftData>(it) }.getOrNull()
                }
            val initial =
                saved
                    ?: AgentDraftData(
                        profile.version,
                        profile.name,
                        profile.speakingStyle,
                        profile.soulText.orEmpty(),
                        profile.avatarId,
                        profile.color,
                    )
            agentSettingsDraftOwner = owner
            agentSettingsDraft =
                AgentSettingsDraft(initial) { data ->
                    if (agentSettingsDraftOwner == owner)
                        store.write(key, WireJson.encodeToString(data))
                }
        }
        return agentSettingsDraft!!
    }

    private var channelFeature: ChannelController? = null
    private var channelIdentity: Pair<String, EverplainApi>? = null

    internal fun channels(): ChannelController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (channelIdentity != (owner to client)) {
            channelFeature?.close()
            channelIdentity = owner to client
            channelFeature =
                ChannelController(client, viewModelScope) { error ->
                    if (sessionOwner == owner && api === client) report(error)
                }
        }
        return channelFeature!!
    }

    private var accountSettingsFeature: AccountSettingsController? = null
    private var accountSettingsIdentity: Pair<String, EverplainApi>? = null

    internal fun accountSettings(): AccountSettingsController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (accountSettingsIdentity != (owner to client)) {
            accountSettingsFeature?.close()
            accountSettingsIdentity = owner to client
            accountSettingsFeature =
                AccountSettingsController(
                    client,
                    viewModelScope,
                    state.value.account,
                    { account ->
                        if (sessionOwner == owner && api === client)
                            update { it.copy(account = account) }
                    },
                    { if (sessionOwner == owner && api === client) logout(localOnly = true) },
                    { error -> if (sessionOwner == owner && api === client) report(error) },
                )
        }
        return accountSettingsFeature!!
    }

    private var memoryFeature: MemoryController? = null
    private var memoryIdentity: Pair<String, EverplainApi>? = null

    internal fun memory(): MemoryController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (memoryIdentity != (owner to client)) {
            memoryFeature?.close()
            memoryIdentity = owner to client
            memoryFeature =
                MemoryController(client, viewModelScope, store, owner) { error ->
                    if (sessionOwner == owner && api === client) report(error)
                }
        }
        return memoryFeature!!
    }

    private var libraryFeature: LibraryController? = null
    private var libraryIdentity: Pair<String, EverplainApi>? = null

    internal fun library(): LibraryController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (libraryIdentity != (owner to client)) {
            libraryFeature?.close()
            libraryIdentity = owner to client
            libraryFeature =
                LibraryController(client, viewModelScope, store, owner) { error ->
                    if (sessionOwner == owner && api === client) report(error)
                }
        }
        return libraryFeature!!
    }

    private var graphFeature: GraphController? = null
    private var graphIdentity: Pair<String, EverplainApi>? = null

    internal fun graph(): GraphController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (graphIdentity != (owner to client)) {
            graphFeature?.close()
            graphIdentity = owner to client
            graphFeature =
                GraphController(client, viewModelScope, store, owner) { error ->
                    if (sessionOwner == owner && api === client) report(error)
                }
        }
        return graphFeature!!
    }

    private var materialFeature: MaterialController? = null
    private var materialIdentity: Pair<String, EverplainApi>? = null

    internal fun materials(): MaterialController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (materialIdentity != (owner to client)) {
            materialFeature?.close()
            materialIdentity = owner to client
            materialFeature =
                MaterialController(
                    client,
                    viewModelScope,
                    store,
                    owner,
                    { scope, context ->
                        if (
                            sessionOwner == owner &&
                                api === client &&
                                state.value.materialScope == scope
                        )
                            update { it.copy(materialContext = context) }
                    },
                ) { error ->
                    if (sessionOwner == owner && api === client) report(error)
                }
        }
        return materialFeature!!
    }

    private var researchFeature: ResearchController? = null
    private var researchIdentity: Pair<String, EverplainApi>? = null
    private val projectMemories = mutableMapOf<String, MemoryController>()

    internal fun research(): ResearchController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (researchIdentity != (owner to client)) {
            researchFeature?.close()
            researchIdentity = owner to client
            researchFeature =
                ResearchController(client, viewModelScope) { error ->
                    if (sessionOwner == owner && api === client) report(error)
                }
        }
        return researchFeature!!
    }

    internal fun projectMemory(task: String): MemoryController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        return projectMemories.getOrPut("${client.endpoint.origin}:$owner:$task") {
            MemoryController(client, viewModelScope, store, owner, task) { error ->
                if (sessionOwner == owner && api === client) report(error)
            }
        }
    }

    fun newResearch() {
        if (state.value.streaming || state.value.stopping) return
        newChat()
        update {
            it.copy(destination = Destination.ResearchLaunch, journey = null, journeyError = null)
        }
    }

    fun openResearch(project: ResearchTaskNavigationResponse) {
        if (state.value.streaming || state.value.stopping) return
        newChat()
        update { it.copy(workspaceTask = project.taskId, destination = Destination.ResearchLaunch) }
        project.conversationId?.let { openConversation(it, Destination.ResearchLaunch) }
    }

    fun loadJourney() {
        val current = api ?: return
        val owner = sessionOwner ?: return
        val id =
            state.value.conversation?.conversationId
                ?: state.value.pending?.conversationId
                ?: return
        viewModelScope.launch {
            update { it.copy(journeyBusy = true, journeyError = null) }
            try {
                val value = current.native.getAgentResearchJourney(id)
                if (
                    api === current &&
                        sessionOwner == owner &&
                        (state.value.conversation?.conversationId
                            ?: state.value.pending?.conversationId) == id
                )
                    update {
                        it.copy(journey = value, workspaceTask = value.taskId ?: it.workspaceTask)
                    }
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                if (e is ApiFailure && e.status == 401) report(e)
                else update { it.copy(journeyError = e.message ?: "研究状态暂时无法恢复") }
            } finally {
                if (api === current && sessionOwner == owner)
                    update { it.copy(journeyBusy = false) }
            }
        }
    }

    private var canvasFeature: CanvasController? = null
    private var canvasIdentity: Pair<String, EverplainApi>? = null

    internal fun canvas(): CanvasController {
        val client = api ?: error("尚未登录")
        val owner = sessionOwner ?: error("尚未登录")
        if (canvasIdentity != (owner to client)) {
            canvasFeature?.close()
            canvasIdentity = owner to client
            canvasFeature =
                CanvasController(
                    client,
                    viewModelScope,
                    store,
                    owner,
                    { conversation ->
                        if (
                            api === client &&
                                sessionOwner == owner &&
                                state.value.conversation?.conversationId ==
                                    conversation.conversationId
                        )
                            update { it.copy(conversation = conversation) }
                    },
                ) { error ->
                    if (api === client && sessionOwner == owner) report(error)
                }
        }
        return canvasFeature!!
    }

    fun confirmResearchStart(proposal: ResearchStartProposalResponse) {
        val client = api ?: return
        val owner = sessionOwner ?: return
        if (state.value.journeyBusy || state.value.streaming) return
        val journal = "research-start:${client.endpoint.origin}:$owner:${proposal.proposalId}"
        val requested =
            ConfirmResearchStartRequest(
                proposal.context,
                proposal.version,
                proposal.phenomenon,
                proposal.researchIntent,
            )
        val existing =
            store.read(journal)?.let {
                runCatching { WireJson.decodeFromString<ResearchStartIntent>(it) }.getOrNull()
            }
        if (existing != null && existing.request != requested) {
            update { it.copy(journeyError = "上次建立结果未确认，请先恢复研究状态核对。") }
            return
        }
        val intent = existing ?: ResearchStartIntent(newIntentKey(), requested)
        try {
            store.write(journal, WireJson.encodeToString(intent))
        } catch (e: Throwable) {
            update { it.copy(journeyError = "无法安全记录研究确认。") }
            return
        }
        update { it.copy(journeyBusy = true, journeyError = null) }
        viewModelScope.launch {
            try {
                val response =
                    client.native.confirmAgentResearchStart(
                        proposal.proposalId,
                        intent.key,
                        intent.request,
                    )
                store.write(journal, null)
                if (api === client && sessionOwner == owner)
                    update {
                        it.copy(
                            journey =
                                AgentResearchJourneyResponse(
                                    response.conversationId,
                                    response.navigation,
                                    response.proposal,
                                    response.status,
                                    response.taskId,
                                ),
                            workspaceTask = response.taskId,
                        )
                    }
            } catch (e: Throwable) {
                if (e is CancellationException) throw e
                if (e is ApiFailure && e.status in 400..499 && e.status != 408)
                    store.write(journal, null)
                if (e is ApiFailure && e.status == 401) report(e)
                else if (api === client && sessionOwner == owner)
                    update { it.copy(journeyError = e.message ?: "研究建立失败") }
            } finally {
                if (api === client && sessionOwner == owner) update { it.copy(journeyBusy = false) }
            }
        }
    }

    init {
        restore()
    }

    private fun update(block: (AppState) -> AppState) {
        mutable.update(block)
    }

    fun setAppearance(value: String) {
        if (value !in setOf("system", "light", "dark")) return
        store.write("appearance", value)
        update { it.copy(appearance = value) }
    }

    fun clearError() = update { it.copy(error = null) }

    private fun report(error: Throwable) {
        if (error is CancellationException) return
        if (error is ApiFailure && error.status == 401) {
            generation++
            streamJob?.cancel()
            stopJob?.cancel()
            api?.clearLocalSession()
            store.write("pending", null)
            memoryFeature?.close()
            libraryFeature?.close()
            libraryFeature = null
            libraryIdentity = null
            graphFeature?.close()
            graphFeature = null
            materialFeature?.close()
            materialFeature = null
            materialIdentity = null
            researchFeature?.close()
            researchFeature = null
            researchIdentity = null
            projectMemories.values.forEach { it.close() }
            projectMemories.clear()
            canvasFeature?.close()
            canvasFeature = null
            canvasIdentity = null
            graphIdentity = null
            memoryFeature = null
            memoryIdentity = null
            agentSettingsDraft = null
            agentSettingsDraftOwner = null
            channelFeature?.close()
            channelFeature = null
            channelIdentity = null
            accountSettingsFeature?.close()
            accountSettingsFeature = null
            accountSettingsIdentity = null
            sessionOwner = null
            update {
                AppState(
                    origin = it.origin,
                    appearance = it.appearance,
                    starting = false,
                    error = "登录已过期，请重新登录",
                )
            }
        } else update { it.copy(error = error.message ?: "连接失败，请稍后重试", busy = false) }
    }

    private fun restore() {
        viewModelScope.launch {
            val origin = state.value.origin
            if (store.read("origin").isNullOrBlank()) {
                update { it.copy(starting = false) }
                return@launch
            }
            try {
                api = EverplainApi(Endpoint.parse(origin), store)
                acceptSession(api!!.session())
                loadHome()
                val pending =
                    store.read("pending")?.let {
                        runCatching { WireJson.decodeFromString<PendingTurn>(it) }.getOrNull()
                    }
                if (
                    pending != null &&
                        pending.owner == sessionOwner &&
                        pending.origin == api?.endpoint?.origin
                ) {
                    update {
                        it.copy(
                            pending = pending,
                            destination = Destination.Chat,
                            status = "上次回答尚未完成，核对后可恢复",
                        )
                    }
                    reconcilePending()
                } else store.write("pending", null)
            } catch (e: Exception) {
                report(e)
            } finally {
                update { it.copy(starting = false) }
            }
        }
    }

    fun login(origin: String, email: String, password: String) =
        authenticate(origin, email, password, null)

    fun register(origin: String, email: String, password: String, code: String) =
        authenticate(origin, email, password, code)

    fun setRegistrationCodeDraft(value: String) {
        if (state.value.session == null && !state.value.busy)
            update { it.copy(registrationCodeDraft = value.filter { c -> c in '0'..'9' }.take(6)) }
    }

    fun resetRegistrationFlow() {
        if (!state.value.busy)
            update {
                it.copy(
                    registrationCodeDraft = "",
                    registrationEmail = null,
                    registrationResendUntil = 0,
                )
            }
    }

    fun sendRegistrationCode(origin: String, email: String) {
        if (state.value.busy) return
        if (
            state.value.registrationEmail == email &&
                android.os.SystemClock.elapsedRealtime() < state.value.registrationResendUntil
        )
            return
        update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val result = EverplainApi(Endpoint.parse(origin), store).sendRegistrationCode(email)
                update {
                    it.copy(
                        registrationEmail = email,
                        registrationCodeSequence = it.registrationCodeSequence + 1,
                        registrationResendUntil =
                            android.os.SystemClock.elapsedRealtime() +
                                (result.resendAfterSeconds ?: 60).coerceIn(0, 86_400) * 1000,
                    )
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                update {
                    it.copy(
                        error =
                            if (e is ApiFailure && e.status == 429) "验证码发送过于频繁，请稍后再试。"
                            else "验证码暂时无法发送，请稍后再试。"
                    )
                }
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }

    private fun authenticate(origin: String, email: String, password: String, code: String?) {
        if (state.value.busy) return
        update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val endpoint = Endpoint.parse(origin)
                val next = EverplainApi(endpoint, store)
                val session =
                    if (code == null) next.login(email.trim(), password)
                    else next.register(email.trim(), password, code)
                generation++
                streamJob?.cancel()
                if (state.value.origin != endpoint.origin) {
                    api?.clearLocalSession()
                    store.write("pending", null)
                }
                api = next
                store.write("origin", endpoint.origin)
                update {
                    AppState(
                        origin = endpoint.origin,
                        appearance = it.appearance,
                        starting = false,
                        busy = true,
                    )
                }
                acceptSession(session)
                loadHome()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                // Authentication errors must not be mistaken for expiry of a previous session.
                val message =
                    if (state.value.session != null) {
                        report(e)
                        null
                    } else if (code == null) {
                        if (e is ApiFailure && e.status == 401) "邮箱或密码不正确，请重新输入。"
                        else "登录服务暂时不可用，请稍后重试。"
                    } else
                        when ((e as? ApiFailure)?.status) {
                            422 -> "验证码无效或已过期，请重新获取。"
                            409 -> "该邮箱无法用于注册。"
                            else -> "账号创建失败，请稍后重试。"
                        }
                if (message != null) update { it.copy(error = message) }
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }

    private fun acceptSession(session: SessionResponse) {
        if (session.status != "active") throw ApiFailure(401, "inactive_session", "登录已失效，请重新登录")
        if (sessionOwner != null && sessionOwner != session.user.userId) {
            store.write("pending", null)
            generation++
            streamJob?.cancel()
            stopJob?.cancel()
            profileIntent = null
            update { AppState(origin = it.origin, appearance = it.appearance, starting = false) }
        }
        sessionOwner = session.user.userId
        val records =
            store
                .read("recoveries")
                ?.let {
                    runCatching { WireJson.decodeFromString<List<PendingTurn>>(it) }.getOrNull()
                }
                .orEmpty()
                .filter { it.owner == sessionOwner && it.origin == api?.endpoint?.origin }
        update { it.copy(session = session, recoveries = records) }
    }

    fun onForeground() {
        val currentApi = api
        val owner = sessionOwner
        if (state.value.session == null || refreshJob?.isActive == true) return
        refreshJob =
            viewModelScope.launch {
                try {
                    val session = api!!.session()
                    if (sessionOwner == owner && api === currentApi) acceptSession(session)
                } catch (e: Exception) {
                    if (sessionOwner == owner && api === currentApi) report(e)
                }
            }
    }

    private suspend fun loadHome() = supervisorScope {
        val owner = sessionOwner ?: return@supervisorScope
        val currentApi = api ?: return@supervisorScope
        suspend fun read(block: suspend () -> Unit) {
            try {
                block()
            } catch (e: Exception) {
                if (sessionOwner == owner && api === currentApi) report(e)
            }
        }
        listOf(
                async {
                    read {
                        val profile = currentApi.profile()
                        if (sessionOwner == owner && api === currentApi)
                            update {
                                it.copy(
                                    profile = profile,
                                    settingsConflictReady =
                                        if (it.settingsConflict) true else it.settingsConflictReady,
                                )
                            }
                    }
                },
                async {
                    read {
                        val catalog = currentApi.models()
                        if (sessionOwner == owner && api === currentApi) {
                            val saved =
                                store.read("selection:${currentApi.endpoint.origin}:$owner")?.let {
                                    runCatching { WireJson.decodeFromString<SavedSelection>(it) }
                                        .getOrNull()
                                }
                            val choice =
                                catalog.items.find {
                                    it.modelId == (state.value.model ?: saved?.modelId)
                                } ?: catalog.items.firstOrNull()
                            update {
                                it.copy(
                                    catalog = catalog,
                                    model = choice?.modelId,
                                    effort =
                                        choice?.reasoningEfforts?.firstOrNull { value ->
                                            value == (it.effort ?: saved?.effort)
                                        }
                                            ?: choice?.defaultReasoningEffort?.takeIf { effort ->
                                                choice.reasoningEfforts.contains(effort)
                                            }
                                            ?: choice?.reasoningEfforts?.firstOrNull(),
                                )
                            }
                        }
                    }
                },
                async {
                    read {
                        val history = currentApi.history()
                        if (sessionOwner == owner && api === currentApi)
                            update { it.copy(history = history) }
                    }
                },
            )
            .awaitAll()
    }

    fun refresh() {
        viewModelScope.launch {
            update { it.copy(busy = true, error = null) }
            try {
                if (state.value.destination == Destination.Account) loadAccount() else loadHome()
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }

    fun navigate(destination: Destination) {
        if ((state.value.streaming || state.value.stopping) && destination != Destination.Chat) {
            update { it.copy(error = "请先停止当前回答，再离开对话") }
            return
        }
        if (destination == Destination.Home && state.value.destination != Destination.Home) {
            newChat()
            update { it.copy(destination = Destination.Home) }
            return
        }
        if (destination != state.value.destination) generation++
        if (destination != Destination.Memory) memoryFeature?.pauseOverview()
        if (destination !in setOf(Destination.Library, Destination.Graph)) libraryFeature?.leave()
        if (destination != Destination.Graph && destination != Destination.Home)
            graphFeature?.leave()
        if (destination !in setOf(Destination.Research, Destination.Home)) researchFeature?.leave()
        update { it.copy(destination = destination, error = null, busy = false) }
        if (destination == Destination.Account) viewModelScope.launch { loadAccount() }
    }

    fun newChat() {
        if (state.value.streaming || state.value.stopping) return
        generation++
        update {
            it.copy(
                destination = Destination.Chat,
                conversation = null,
                referenceLibraryId = null,
                composerMode = "standard",
                materialScope = newIntentKey(),
                materialContext = null,
                workspaceTask = null,
                selectedCitation = null,
                researchPanel = false,
                pending = null,
                draft = "",
                status = null,
                error = null,
                busy = false,
            )
        }
        materialFeature?.bind(state.value.materialScope, null)
        // Durable pending state is retained until completion or explicit replacement by a new send.
    }

    fun newChatWithLibrary(id: String?) {
        if (state.value.streaming || state.value.stopping) return
        newChat()
        update { it.copy(referenceLibraryId = id) }
    }

    fun setDraft(value: String) {
        if (!state.value.streaming) update { it.copy(draft = value.take(12000)) }
    }

    private fun saveSelection() {
        val s = state.value
        if (s.model != null && s.effort != null && sessionOwner != null && api != null)
            store.write(
                "selection:${api!!.endpoint.origin}:$sessionOwner",
                WireJson.encodeToString(SavedSelection(s.model, s.effort)),
            )
    }

    fun selectModel(id: String) {
        val model = state.value.catalog?.items?.find { it.modelId == id } ?: return
        update {
            it.copy(
                model = id,
                effort =
                    model.defaultReasoningEffort.takeIf { it in model.reasoningEfforts }
                        ?: model.reasoningEfforts.firstOrNull(),
            )
        }
        saveSelection()
    }

    fun selectEffort(value: String) {
        if (
            state.value.catalog
                ?.items
                ?.find { it.modelId == state.value.model }
                ?.reasoningEfforts
                ?.contains(value) == true
        )
            update { it.copy(effort = value) }
        saveSelection()
    }

    fun regenerate(question: String) {
        if (state.value.streaming || state.value.stopping || state.value.pending != null) return
        val unsent = state.value.draft
        setDraft(question)
        send()
        update { it.copy(draft = unsent) }
    }

    fun setComposerMode(value: String) {
        if (!state.value.streaming && value in setOf("standard", "deep_research"))
            update { it.copy(composerMode = value) }
    }

    fun selectCitation(citation: AgentCitationResponse) = update {
        it.copy(selectedCitation = citation, researchPanel = true)
    }

    fun backToSources() = update { it.copy(selectedCitation = null) }

    fun toggleResearchPanel() = update { it.copy(researchPanel = !it.researchPanel) }

    fun continueDeepResearch(action: String, selection: String? = null) {
        val current = state.value
        val pending = current.pending ?: return
        if (
            current.streaming ||
                current.stopping ||
                pending.runId == null ||
                pending.signals.research.waitingState == null ||
                action !in setOf("clarify", "confirm", "skip")
        )
            return
        if (action == "clarify" && selection.isNullOrBlank()) return
        val next =
            pending.copy(
                request =
                    pending.request.copy(
                        conversationId = pending.conversationId,
                        deepResearchRunId = pending.runId,
                        deepResearchAction = action,
                        deepResearchSelection = selection,
                    ),
                outcomeConfirmed = false,
                stopKey = null,
            )
        persist(next)
        update { it.copy(pending = next, error = null) }
        beginStream(next)
    }

    fun editResearchPlan() {
        val p = state.value.pending ?: return
        if (state.value.streaming || p.signals.research.waitingState == null) return
        generation++
        update {
            it.copy(
                pending = null,
                draft = p.request.message,
                status = null,
                composerMode = "deep_research",
            )
        }
    }

    fun toggleWebSearch() {
        update { it.copy(webSearch = !it.webSearch) }
    }

    fun send() {
        val s = state.value
        val attached = materialFeature?.state?.value?.attached.orEmpty()
        if (
            materialFeature?.state?.value?.uploading == true ||
                attached.any { it.status != "ready" }
        )
            return
        if (
            s.streaming ||
                s.stopping ||
                s.draft.isBlank() ||
                s.model == null ||
                s.effort == null ||
                s.session == null
        )
            return
        if (
            s.catalog
                ?.items
                ?.find { it.modelId == s.model }
                ?.reasoningEfforts
                ?.contains(s.effort) != true
        )
            return
        if (s.pending != null) {
            update { it.copy(error = "请先恢复或结束尚未完成的回答") }
            return
        }
        val pending =
            PendingTurn(
                s.session.user.userId,
                newIntentKey(),
                AgentTurnRequest(
                    message = s.draft.trim(),
                    conversationId =
                        s.conversation?.conversationId ?: s.materialContext?.conversationId,
                    materialIds = attached.map { it.materialId },
                    referenceKnowledgeBaseId =
                        s.conversation?.referenceKnowledgeBaseId ?: s.referenceLibraryId,
                    mode = s.composerMode,
                    workspace = if (s.workspaceTask != null) "research" else "agent",
                    taskId = s.workspaceTask,
                    modelId = s.model,
                    reasoningEffort = s.effort,
                    webSearch = s.webSearch,
                ),
                origin = api!!.endpoint.origin,
                signals = NativeTurnSignals(canvas = s.conversation?.researchMap),
            )
        persist(pending)
        update {
            it.copy(
                destination =
                    if (s.destination == Destination.ResearchLaunch) Destination.ResearchLaunch
                    else Destination.Chat,
                draft = "",
                pending = pending,
                error = null,
            )
        }
        beginStream(pending)
    }

    private fun eligible(request: AgentTurnRequest) =
        request.mode in setOf(null, "standard", "deep_research") &&
            request.workspace in setOf(null, "agent", "research")

    private fun persist(pending: PendingTurn?) {
        val previousKey = state.value.pending?.key
        val records =
            store
                .read("recoveries")
                ?.let {
                    runCatching { WireJson.decodeFromString<List<PendingTurn>>(it) }.getOrNull()
                }
                .orEmpty()
        val next =
            if (pending != null)
                records.filterNot { it.key == pending.key && it.owner == pending.owner } + pending
            else records.filterNot { it.key == previousKey && it.owner == sessionOwner }
        store.write("recoveries", WireJson.encodeToString(next))
        store.write("pending", pending?.let { WireJson.encodeToString(it) })
        update {
            it.copy(
                recoveries =
                    next.filter { record ->
                        record.owner == sessionOwner && record.origin == api?.endpoint?.origin
                    }
            )
        }
    }

    fun openRecovery(key: String) {
        if (state.value.streaming || state.value.stopping) return
        val pending =
            state.value.recoveries.find {
                it.key == key && it.owner == sessionOwner && it.origin == api?.endpoint?.origin
            } ?: return
        generation++
        update {
            it.copy(
                pending = pending,
                conversation = null,
                destination = Destination.Chat,
                status = "原请求已保留，请先核对状态",
                error = null,
            )
        }
        store.write("pending", WireJson.encodeToString(pending))
        checkPending()
    }

    fun endStopWait() {
        if (!state.value.stopping && !state.value.streaming) return
        val paused = state.value.pending?.copy(outcomeConfirmed = false)
        generation++
        stopJob?.cancel()
        streamJob?.cancel()
        paused?.let { persist(it) }
        update {
            it.copy(
                streaming = false,
                stopping = false,
                busy = false,
                pending = paused,
                status = "仅结束本机等待。服务器状态仍未知，原请求已保留。",
            )
        }
    }

    private fun beginStream(pending: PendingTurn) {
        if (streamJob?.isActive == true) return
        val identity = ++generation
        update {
            it.copy(
                streaming = true,
                stopping = false,
                status = "正在思考…",
                pending = pending.copy(stopKey = null, outcomeConfirmed = false),
                error = null,
            )
        }
        streamJob =
            viewModelScope.launch {
                try {
                    api!!.stream(pending.request, pending.key).collect { frame ->
                        if (identity != generation || sessionOwner != pending.owner) return@collect
                        if (
                            frame.event !in
                                setOf(
                                    "turn_started",
                                    "assistant_delta",
                                    "agent_status",
                                    "tool_started",
                                    "tool_finished",
                                    "tool_failed",
                                    "turn_completed",
                                    "turn_failed",
                                    "turn_interrupted",
                                    "research_waiting",
                                    "research_ask",
                                    "research_plan",
                                    "research_step",
                                    "research_result",
                                    "citation_added",
                                    "canvas_patch",
                                )
                        )
                            return@collect
                        val json = WireJson.parseToJsonElement(frame.data).jsonObject
                        fun text(key: String) = (json[key] as? JsonPrimitive)?.contentOrNull
                        val signals =
                            reduceTurnSignals(
                                state.value.pending?.signals
                                    ?: NativeTurnSignals(
                                        canvas = state.value.conversation?.researchMap
                                    ),
                                frame.event,
                                json,
                            )
                        if (signals != state.value.pending?.signals) {
                            val changed =
                                state.value.pending?.copy(
                                    signals = signals,
                                    partial =
                                        if (signals.citations.any { it.deleted == true })
                                            "该回答引用的个人研究材料已删除，原回答内容已隐藏。"
                                        else state.value.pending!!.partial,
                                )
                            if (changed != null) {
                                persist(changed)
                                update { it.copy(pending = changed) }
                            }
                        }
                        when (frame.event) {
                            "turn_started" -> {
                                val next =
                                    state.value.pending!!.copy(
                                        runId = text("run_id"),
                                        conversationId = text("conversation_id"),
                                        partial = "",
                                    )
                                persist(next)
                                update { it.copy(pending = next) }
                            }
                            "assistant_delta" ->
                                update {
                                    it.copy(
                                        status = "正在回答…",
                                        pending =
                                            it.pending?.copy(
                                                partial =
                                                    if (
                                                        it.pending.signals.citations.any { c ->
                                                            c.deleted == true
                                                        }
                                                    )
                                                        it.pending.partial
                                                    else
                                                        it.pending.partial + text("delta").orEmpty()
                                            ),
                                    )
                                }
                            "agent_status" ->
                                update {
                                    it.copy(
                                        status =
                                            text("text")
                                                ?: text("message")
                                                ?: if (text("status") == "answering") "正在回答…"
                                                else "正在思考…"
                                    )
                                }
                            "tool_started" ->
                                update { it.copy(status = text("detail") ?: "正在使用工具…") }
                            "tool_finished" -> update { it.copy(status = "正在整理回答…") }
                            "tool_failed" -> update { it.copy(status = "工具暂时不可用，正在继续…") }
                            "turn_completed" -> {
                                val conversation =
                                    WireJson.decodeFromJsonElement<AgentConversationResponse>(
                                        json.getValue("conversation")
                                    )
                                persist(null)
                                materialFeature?.clearAfterSend()
                                update {
                                    it.copy(
                                        conversation = conversation,
                                        turnSignals =
                                            conversation.turns.lastOrNull()?.turnId?.let { id ->
                                                it.turnSignals +
                                                    (id to
                                                        completedSignals(
                                                            it.pending?.signals
                                                                ?: NativeTurnSignals(),
                                                            conversation.turns.last(),
                                                        ))
                                            } ?: it.turnSignals,
                                        turnKeys =
                                            conversation.turns.lastOrNull()?.turnId?.let { turnId ->
                                                it.turnKeys + (turnId to "pending:${pending.key}")
                                            } ?: it.turnKeys,
                                        pending = null,
                                        status = null,
                                    )
                                }
                            }
                            "research_waiting" -> {
                                val terminal =
                                    state.value.pending?.copy(
                                        runId = text("run_id") ?: state.value.pending?.runId,
                                        outcomeConfirmed = true,
                                    )
                                persist(terminal)
                                update { it.copy(pending = terminal, status = null) }
                            }
                            "turn_failed",
                            "turn_interrupted" -> {
                                val terminal = state.value.pending?.copy(outcomeConfirmed = true)
                                persist(terminal)
                                update {
                                    it.copy(
                                        pending = terminal,
                                        status =
                                            text("message")
                                                ?: if (frame.event == "turn_interrupted")
                                                    "已停止，可恢复原来的回答"
                                                else "回答尚未完成，可恢复原来的回答",
                                        error =
                                            if (frame.event == "turn_failed")
                                                text("message") ?: "回答失败"
                                            else null,
                                    )
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    if (identity == generation) {
                        persist(state.value.pending)
                        report(e)
                        update { it.copy(status = "回答中断，可核对并恢复") }
                    }
                } finally {
                    if (identity == generation) {
                        update { it.copy(streaming = false) }
                        try {
                            val history = api!!.history()
                            if (identity == generation && sessionOwner == pending.owner)
                                update { it.copy(history = history) }
                        } catch (_: Exception) {}
                    }
                }
            }
    }

    private suspend fun reconcilePending(): AgentRunLookupResponse? {
        val pending = state.value.pending ?: return null
        val currentApi = api ?: return null
        val lookup =
            try {
                currentApi.lookupRun(pending.key)
            } catch (error: ApiFailure) {
                if (error.status == 404) null else throw error
            }
        fun stillCurrent() =
            api === currentApi &&
                sessionOwner == pending.owner &&
                state.value.pending?.key == pending.key
        if (!stillCurrent()) return null
        if (lookup != null) {
            require(lookup.idempotencyKey == pending.key) { "服务返回的运行标识与原请求不一致" }
            val next =
                pending.copy(
                    runId = lookup.runId,
                    conversationId = lookup.conversationId,
                    partial = lookup.partialAnswer,
                    outcomeConfirmed = lookup.status != "running",
                )
            persist(next)
            update { it.copy(pending = next) }
            val conversation = currentApi.conversation(lookup.conversationId)
            if (!stillCurrent()) return null
            if (lookup.status == "completed") {
                persist(null)
                update { it.copy(conversation = conversation, pending = null, status = null) }
            } else {
                val waiting =
                    conversation.unfinishedRuns?.firstOrNull { it.idempotencyKey == pending.key }
                val recovered =
                    if (waiting?.status?.startsWith("awaiting_") == true)
                        next.copy(signals = recoverySignals(waiting))
                    else next
                persist(recovered)
                update {
                    it.copy(
                        conversation = conversation,
                        pending = recovered,
                        status =
                            when (lookup.status) {
                                "running" ->
                                    if (lookup.cancelRequested) "服务端正在处理停止请求" else "服务端仍在处理这段回答"
                                "interrupted" -> "已确认中断，可恢复原来的回答"
                                "failed" -> "上次回答未完成，可恢复原来的回答"
                                "awaiting_clarification",
                                "awaiting_plan_confirmation" -> null
                                else -> "这段回答尚未结束"
                            },
                    )
                }
            }
            return lookup
        }
        // 404 can mean an older server or a run not visible yet. Never turn it into
        // "not executed" and never POST a new turn as a read-only lookup fallback.
        val id = pending.conversationId
        if (id != null) {
            val conversation = currentApi.conversation(id)
            if (!stillCurrent()) return null
            val recovered = conversation.unfinishedRuns?.find { it.idempotencyKey == pending.key }
            val next =
                recovered?.let {
                    pending.copy(
                        runId = it.runId,
                        conversationId = id,
                        partial = it.partialAnswer,
                        outcomeConfirmed = it.status != "running",
                        signals = recoverySignals(it),
                    )
                } ?: pending
            persist(next)
            update {
                it.copy(conversation = conversation, pending = next, status = "已读取对话；原请求的最终状态仍待确认")
            }
        } else update { it.copy(status = "暂未查到运行记录。原请求仍保留，不能据此确认尚未执行。") }
        return null
    }

    fun checkPending() {
        if (state.value.streaming || state.value.busy || state.value.stopping) return
        update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                reconcilePending()
            } catch (error: Exception) {
                report(error)
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }

    fun resume() {
        if (state.value.streaming || state.value.stopping) return
        viewModelScope.launch {
            update { it.copy(busy = true, error = null) }
            try {
                reconcilePending()
                state.value.pending?.let {
                    if (it.stopKey != null && !it.outcomeConfirmed)
                        update { state -> state.copy(error = "停止结果仍未知，请先核对状态。不要重复发起同一个请求。") }
                    else if (it.signals.research.waitingState != null)
                        update { state -> state.copy(status = null) }
                    else if (eligible(it.request)) beginStream(it)
                    else update { state -> state.copy(error = "这段回答属于网页版的研究功能，请在网页继续。") }
                }
            } catch (e: Exception) {
                report(e)
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }

    fun stop() {
        val pending = state.value.pending ?: return
        if (state.value.stopping) return
        val owner = sessionOwner
        val currentApi = api ?: return
        val key = pending.stopKey ?: newIntentKey()
        val next = pending.copy(stopKey = key)
        persist(next)
        if (pending.runId == null) {
            generation++
            streamJob?.cancel()
        }
        update {
            it.copy(
                pending = next,
                stopping = true,
                streaming = if (pending.runId == null) false else it.streaming,
                status = "正在核对并确认停止…",
                error = null,
            )
        }
        val stopGeneration = generation
        stopJob =
            viewModelScope.launch {
                try {
                    val runId =
                        pending.runId ?: reconcilePending()?.runId ?: state.value.pending?.runId
                    if (
                        generation != stopGeneration ||
                            sessionOwner != owner ||
                            api !== currentApi ||
                            (state.value.pending != null && state.value.pending?.key != pending.key)
                    )
                        return@launch
                    if (state.value.pending == null) {
                        update { it.copy(stopping = false) }
                        return@launch
                    }
                    if (runId == null) {
                        update {
                            it.copy(stopping = false, status = "已断开本机连接，服务端停止尚未确认。请稍后核对状态或重试停止。")
                        }
                        return@launch
                    }
                    var result = currentApi.stop(runId, key)
                    var polls = 0
                    while (
                        result.status == "running" &&
                            generation == stopGeneration &&
                            sessionOwner == owner &&
                            api === currentApi &&
                            state.value.pending?.key == pending.key
                    ) {
                        delay(700)
                        if (++polls % 3 == 0) {
                            // GET conversation performs the server's expired-lease recovery.
                            state.value.pending?.conversationId?.let { currentApi.conversation(it) }
                            reconcilePending()
                            if (state.value.pending == null) {
                                update { it.copy(stopping = false) }
                                return@launch
                            }
                        }
                        result = currentApi.stop(runId, key)
                    }
                    if (
                        generation != stopGeneration ||
                            sessionOwner != owner ||
                            api !== currentApi ||
                            (state.value.pending != null && state.value.pending?.key != pending.key)
                    )
                        return@launch
                    if (state.value.pending == null) {
                        update { it.copy(stopping = false) }
                        return@launch
                    }
                    if (result.status != "running") {
                        generation++
                        streamJob?.cancelAndJoin()
                        persist(state.value.pending)
                        update {
                            it.copy(streaming = false, stopping = false, status = "已确认停止，可恢复原来的回答")
                        }
                        reconcilePending()
                    }
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    if (
                        generation == stopGeneration &&
                            sessionOwner == owner &&
                            api === currentApi &&
                            state.value.pending?.key == pending.key
                    ) {
                        report(error)
                        update { it.copy(stopping = false, status = "停止尚未确认，请重试") }
                    }
                }
            }
    }

    fun openConversation(id: String, target: Destination = Destination.Chat) {
        if (state.value.streaming || state.value.stopping) return
        val identity = ++generation
        update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val conversation = api!!.conversation(id)
                val run = conversation.unfinishedRuns?.lastOrNull { eligible(it.request) }
                val pending =
                    run?.let {
                        PendingTurn(
                            sessionOwner!!,
                            it.idempotencyKey,
                            it.request,
                            it.runId,
                            id,
                            it.partialAnswer,
                            origin = api!!.endpoint.origin,
                            signals = recoverySignals(it),
                        )
                    }
                if (identity == generation) {
                    update {
                        it.copy(
                            conversation = conversation,
                            referenceLibraryId = conversation.referenceKnowledgeBaseId,
                            workspaceTask = conversation.taskId,
                            materialScope = "conversation:${conversation.conversationId}",
                            materialContext =
                                conversation.taskId?.let { task ->
                                    AgentMaterialContextResponse(conversation.conversationId, task)
                                },
                            composerMode = run?.request?.mode ?: "standard",
                            pending = pending,
                            destination = target,
                            status = if (pending != null) "这段回答尚未完成" else null,
                            draft = "",
                        )
                    }
                    if (pending != null) persist(pending)
                }
            } catch (e: Exception) {
                if (identity == generation) report(e)
            } finally {
                if (identity == generation) update { it.copy(busy = false) }
            }
        }
    }

    fun openAccountSection(section: String) {
        update { it.copy(accountSection = section) }
        navigate(Destination.Account)
    }

    fun loadAccountMenu() {
        val current = api ?: return
        val owner = sessionOwner ?: return
        if (state.value.accountMenuLoading) return
        update {
            it.copy(accountMenuLoading = true, planUnavailable = false, usageUnavailable = false)
        }
        viewModelScope.launch {
            supervisorScope {
                listOf(
                        launch {
                            try {
                                val value = current.native.getSubscription()
                                if (api === current && sessionOwner == owner)
                                    update { it.copy(subscription = value) }
                            } catch (e: Exception) {
                                if (e is CancellationException) throw e
                                if (api === current && sessionOwner == owner) {
                                    if (e is ApiFailure && e.status == 401) report(e)
                                    else update { it.copy(planUnavailable = true) }
                                }
                            }
                        },
                        launch {
                            try {
                                val value = current.credits()
                                if (api === current && sessionOwner == owner)
                                    update { it.copy(credits = value) }
                            } catch (e: Exception) {
                                if (e is CancellationException) throw e
                                if (api === current && sessionOwner == owner) {
                                    if (e is ApiFailure && e.status == 401) report(e)
                                    else update { it.copy(usageUnavailable = true) }
                                }
                            }
                        },
                    )
                    .joinAll()
            }
            if (api === current && sessionOwner == owner)
                update { it.copy(accountMenuLoading = false) }
        }
    }

    private suspend fun loadAccount() = supervisorScope {
        val owner = sessionOwner ?: return@supervisorScope
        val currentApi = api ?: return@supervisorScope
        update { it.copy(busy = true, error = null) }
        suspend fun read(block: suspend () -> Unit) {
            try {
                block()
            } catch (e: Exception) {
                if (sessionOwner == owner && api === currentApi) report(e)
            }
        }
        listOf(
                async {
                    read {
                        val v = currentApi.account()
                        if (sessionOwner == owner && api === currentApi)
                            update { it.copy(account = v) }
                    }
                },
                async {
                    read {
                        val v = currentApi.credits()
                        if (sessionOwner == owner && api === currentApi)
                            update { it.copy(credits = v) }
                    }
                },
                async {
                    read {
                        val v = currentApi.sessions()
                        if (sessionOwner == owner && api === currentApi)
                            update { it.copy(sessions = v.items) }
                    }
                },
            )
            .awaitAll()
        if (sessionOwner == owner && api === currentApi) update { it.copy(busy = false) }
    }

    fun saveAccountName(name: String, expectedVersion: Long) {
        if (state.value.busy || name.isBlank() || name.length > 80) return
        val currentApi = api ?: return
        val owner = sessionOwner
        val request = UpdateProfileRequest(name.trim(), expectedVersion)
        val intent =
            accountIntent?.takeIf { it.first == request }
                ?: (request to newIntentKey()).also { accountIntent = it }
        update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val account = currentApi.updateAccountName(request, intent.second)
                accountIntent = null
                if (sessionOwner == owner && api === currentApi)
                    update { it.copy(account = account) }
            } catch (error: Exception) {
                if (sessionOwner == owner && api === currentApi) {
                    report(error)
                    if (error is ApiFailure && error.status == 409) {
                        accountIntent = null
                        runCatching { currentApi.account() }
                            .getOrNull()
                            ?.let { latest -> update { it.copy(account = latest) } }
                    }
                }
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }

    fun saveProfile(
        name: String,
        style: String,
        soul: String,
        avatar: String,
        color: String,
        expectedVersion: Long,
    ) {
        val version = expectedVersion
        if (state.value.busy || state.value.settingsConflict) return
        if (
            name.isBlank() ||
                name.length > 40 ||
                style !in setOf("clear", "warm", "rigorous", "curious") ||
                soul.length > 8000 ||
                !color.matches(Regex("#[0-9a-fA-F]{6}"))
        )
            return
        val request =
            AgentProfileUpdate(
                expectedVersion = version,
                name = name.trim(),
                speakingStyle = style.trim(),
                soulText = soul,
                avatarId = avatar,
                color = color,
            )
        val owner = sessionOwner
        val currentApi = api
        val intent =
            profileIntent?.takeIf { it.first == request }
                ?: (request to newIntentKey()).also { profileIntent = it }
        update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val saved = api!!.updateProfile(request, intent.second)
                if (sessionOwner != owner || api !== currentApi) return@launch
                profileIntent = null
                update { it.copy(profile = saved, settingsSaved = it.settingsSaved + 1) }
            } catch (e: Exception) {
                if (sessionOwner != owner || api !== currentApi) return@launch
                if (e is ApiFailure && e.status == 409) {
                    profileIntent = null
                    update {
                        it.copy(
                            settingsConflict = true,
                            settingsConflictReady = false,
                            error = "设置已在其他设备更新。你的草稿保留着，请核对最新内容再保存。",
                        )
                    }
                    try {
                        val latest = api!!.profile()
                        update { it.copy(profile = latest, settingsConflictReady = true) }
                    } catch (fetch: Exception) {
                        report(fetch)
                    }
                } else report(e)
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }

    fun acknowledgeConflict() {
        if (state.value.settingsConflictReady)
            update { it.copy(settingsConflict = false, error = null) }
    }

    fun logout(localOnly: Boolean = false) {
        if (state.value.streaming || state.value.stopping || state.value.busy) return
        update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                if (!localOnly) api!!.logout()
                generation++
                streamJob?.cancel()
                stopJob?.cancel()
                api?.clearLocalSession()
                store.write("pending", null)
                memoryFeature?.close()
                libraryFeature?.close()
                libraryFeature = null
                libraryIdentity = null
                graphFeature?.close()
                graphFeature = null
                materialFeature?.close()
                materialFeature = null
                materialIdentity = null
                researchFeature?.close()
                researchFeature = null
                researchIdentity = null
                projectMemories.values.forEach { it.close() }
                projectMemories.clear()
                canvasFeature?.close()
                canvasFeature = null
                canvasIdentity = null
                graphIdentity = null
                memoryFeature = null
                memoryIdentity = null
                channelFeature?.close()
                channelFeature = null
                channelIdentity = null
                accountSettingsFeature?.close()
                accountSettingsFeature = null
                accountSettingsIdentity = null
                sessionOwner = null
                profileIntent = null
                update {
                    AppState(origin = it.origin, appearance = it.appearance, starting = false)
                }
            } catch (e: Exception) {
                report(e)
            } finally {
                update { it.copy(busy = false) }
            }
        }
    }
}
