@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.everplain.android

import androidx.activity.compose.BackHandler
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.key.*
import androidx.compose.ui.layout.*
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

@Composable
fun EverplainApp(vm: AppViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) vm.onForeground()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    EverplainTheme(s.appearance) {
        Surface(Modifier.fillMaxSize()) {
            when {
                s.starting ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        AgentLiquid(label = "正在恢复登录")
                    }
                s.session == null -> AuthScreen(s, vm)
                else -> key(s.session?.user?.userId) { MainShell(s, vm) }
            }
        }
    }
}

@Composable
private fun MainShell(s: AppState, vm: AppViewModel) {
    val companionPointer = remember { CompanionPointer() }
    val companionNarrow = LocalConfiguration.current.screenWidthDp <= 640
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val drawerWidth =
        with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() * .86f }
            .coerceAtMost(320.dp)
    var historyExpanded by rememberSaveable { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val settingsPages = rememberSaveableStateHolder()
    var conversationActions by remember { mutableStateOf(false) }
    var identityTab by rememberSaveable { mutableStateOf<String?>(null) }
    var leaving by remember { mutableStateOf(false) }
    var endWait by remember { mutableStateOf(false) }
    BackHandler(drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(!drawer.isOpen && s.destination != Destination.Home) {
        if (s.streaming) leaving = true else vm.navigate(Destination.Home)
    }
    if (leaving)
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("回答还在生成") },
            text = { Text("先停止回答，确认后就可以返回首页。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        leaving = false
                        vm.stop()
                    },
                    enabled = !s.stopping,
                ) {
                    Text("停止回答")
                }
            },
            dismissButton = { TextButton(onClick = { leaving = false }) { Text("继续查看") } },
        )
    if (endWait)
        AlertDialog(
            onDismissRequest = { endWait = false },
            title = { Text("结束本次等待？") },
            text = { Text("只结束本机等待，服务器状态仍然未知。原请求会保留供以后核对，不会自动重发。") },
            confirmButton = {
                EpButton(
                    "结束本次等待",
                    {
                        vm.endStopWait()
                        endWait = false
                    },
                    primary = true,
                )
            },
            dismissButton = { EpButton("继续等待", { endWait = false }) },
        )
    if (s.researchPanel) ResearchSourcePanel(s, vm)
    if (identityTab != null)
        settingsPages.SaveableStateProvider("identity-panel") {
            RoleIdentityPanel(s, vm, identityTab!!) { identityTab = null }
        }
    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(
                modifier = Modifier.width(drawerWidth),
                drawerShape = RoundedCornerShape(0.dp),
                drawerContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            ) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        painterResource(R.drawable.everplain_logo),
                        null,
                        Modifier.size(24.dp),
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        "Everplain",
                        Modifier.weight(1f),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    EpIcon(NavIcons.Close, "关闭菜单", { scope.launch { drawer.close() } })
                }
                DrawerNavRow("新对话", NavIcons.Compose, s.destination == Destination.Chat) {
                    vm.newChat()
                    scope.launch { drawer.close() }
                }
                DrawerNavRow("首页", NavIcons.Home, s.destination == Destination.Home) {
                    vm.navigate(Destination.Home)
                    scope.launch { drawer.close() }
                }
                DrawerNavRow("知识库", NavIcons.Library, s.destination == Destination.Library) {
                    vm.navigate(Destination.Library)
                    scope.launch { drawer.close() }
                }
                DrawerNavRow("图谱", NavIcons.Graph, s.destination == Destination.Graph) {
                    vm.navigate(Destination.Graph)
                    scope.launch { drawer.close() }
                }
                DrawerNavRow(
                    "研究",
                    NavIcons.File,
                    s.destination in setOf(Destination.Research, Destination.ResearchLaunch),
                ) {
                    vm.navigate(Destination.Research)
                    scope.launch { drawer.close() }
                }
                Column(
                    Modifier.weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 8.dp)
                ) {
                    Row(
                        Modifier.fillMaxWidth()
                            .heightIn(min = 44.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { historyExpanded = !historyExpanded }
                            .padding(horizontal = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "最近对话",
                            Modifier.weight(1f),
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Icon(NavIcons.Chevron, null, Modifier.size(18.dp))
                    }
                    if (historyExpanded)
                        s.history.take(20).forEach { conversation ->
                            Text(
                                conversation.title?.takeIf { it.isNotBlank() } ?: "新对话",
                                Modifier.fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .clickable {
                                        vm.openConversation(conversation.conversationId)
                                        scope.launch { drawer.close() }
                                    }
                                    .padding(horizontal = 8.dp, vertical = 12.dp),
                                fontSize = 14.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                }
                DrawerAccount(
                    s,
                    vm,
                    openIdentity = { tab -> identityTab = tab },
                    closeDrawer = { scope.launch { drawer.close() } },
                )
            }
        },
    ) {
        Scaffold(
            contentWindowInsets = WindowInsets.safeDrawing,
            topBar = {
                Row(
                    Modifier.fillMaxWidth()
                        .statusBarsPadding()
                        .height(56.dp)
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                        EpIcon(NavIcons.Menu, "打开导航", { scope.launch { drawer.open() } })
                    }
                    if (s.destination == Destination.Chat) {
                        ConversationModeSwitch(s, vm)
                    } else
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(
                                painterResource(R.drawable.everplain_logo),
                                null,
                                Modifier.size(26.dp),
                                tint = MaterialTheme.colorScheme.onSurface,
                            )
                            Text("Everplain", fontSize = 17.sp, fontWeight = FontWeight.Medium)
                        }
                    if (s.destination == Destination.Chat)
                        Row {
                            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                                EpIcon(EpIcons.Menu, "打开对话记录", { vm.navigate(Destination.History) })
                            }
                            Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                                EpIcon(EpIcons.MoreHoriz, "更多对话操作", { conversationActions = true })
                                DropdownMenu(
                                    conversationActions,
                                    { conversationActions = false },
                                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("联网搜索", fontSize = 14.sp) },
                                        onClick = { vm.toggleWebSearch() },
                                        trailingIcon = {
                                            Checkbox(s.webSearch, { vm.toggleWebSearch() })
                                        },
                                        enabled = !s.streaming,
                                    )
                                    DropdownMenuItem(
                                        text = { Text("研究面板", fontSize = 14.sp) },
                                        onClick = {
                                            conversationActions = false
                                            vm.toggleResearchPanel()
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("新对话", fontSize = 14.sp) },
                                        onClick = {
                                            conversationActions = false
                                            vm.newChat()
                                        },
                                        enabled = !s.streaming && !s.stopping,
                                    )
                                }
                            }
                        }
                    else
                        Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
                            EpIcon(
                                EpIcons.EditNote,
                                "新对话",
                                vm::newChat,
                                enabled = !s.streaming && !s.stopping,
                            )
                        }
                }
            },
        ) { padding ->
            Box(
                Modifier.fillMaxSize()
                    .padding(padding)
                    .consumeWindowInsets(padding)
                    .observeCompanionPointer(companionPointer),
                contentAlignment = Alignment.TopCenter,
            ) {
                Column(
                    Modifier.widthIn(
                            max =
                                when (s.destination) {
                                    Destination.Graph -> 1280.dp
                                    Destination.Library,
                                    Destination.Research -> 1120.dp
                                    else -> 840.dp
                                }
                        )
                        .fillMaxSize()
                ) {
                    if (s.stopping) EpButton("结束本次等待", { endWait = true })
                    if (s.busy)
                        LinearProgressIndicator(
                            Modifier.fillMaxWidth().semantics { contentDescription = "正在加载" }
                        )
                    s.error?.let {
                        ErrorCard(
                            it,
                            Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                            vm::clearError,
                        )
                    }
                    when (s.destination) {
                        Destination.Home,
                        Destination.Chat -> ConversationScreen(s, vm)
                        Destination.History -> HistoryScreen(s, vm)
                        Destination.Research ->
                            settingsPages.SaveableStateProvider("research") {
                                ResearchHubScreen(s, vm)
                            }
                        Destination.ResearchLaunch -> ResearchLaunchScreen(s, vm)
                        Destination.Files ->
                            settingsPages.SaveableStateProvider("files") {
                                MaterialsScreen(vm.materials(), s)
                            }
                        Destination.Graph ->
                            settingsPages.SaveableStateProvider("graph") {
                                GraphScreen(vm.graph(), vm.library(), vm)
                            }
                        Destination.Library ->
                            settingsPages.SaveableStateProvider("library") {
                                LibraryScreen(vm.library(), s.origin) {
                                    vm.navigate(Destination.Graph)
                                }
                            }
                        Destination.Account ->
                            settingsPages.SaveableStateProvider("account") { AccountScreen(s, vm) }
                        Destination.Agent ->
                            settingsPages.SaveableStateProvider("agent") { AgentSettings(s, vm) }
                        Destination.Memory ->
                            settingsPages.SaveableStateProvider("memory") {
                                MemoryScreen(vm.memory(), vm)
                            }
                    }
                }
                HomeCompanion(
                    active = s.destination == Destination.Home,
                    modifier =
                        Modifier.align(Alignment.BottomEnd)
                            .padding(end = if (companionNarrow) 8.dp else 24.dp)
                            .offset(y = 14.dp),
                    narrow = companionNarrow,
                    pointer = companionPointer,
                )
            }
        }
    }
}

/**
 * The editor is one permanently mounted child for Home and Chat. Only its siblings and layout
 * weights change, so a first send never detaches the native input connection.
 */
@Composable
internal fun ConversationScreen(s: AppState, vm: AppViewModel) {
    val home = s.destination == Destination.Home
    val empty = s.conversation == null && s.pending == null
    val homeScroll = rememberScrollState()
    val flight = remember { SendFlightState() }
    val motion = rememberMotionEnabled()
    var flightOrigin by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf<androidx.compose.ui.unit.IntSize?>(null) }
    val imeHeight = WindowInsets.ime.getBottom(LocalDensity.current)
    LaunchedEffect(s.stopping, motion) { if (s.stopping || !motion) flight.cancel() }
    LaunchedEffect(home, empty) { if (home || empty) flight.cancel() }
    LaunchedEffect(imeHeight) { flight.cancel() }
    CompositionLocalProvider(LocalSendFlight provides flight) {
        Box(
            Modifier.fillMaxSize()
                .onGloballyPositioned { flightOrigin = it.positionInRoot() }
                .onSizeChanged {
                    if (viewport != null && viewport != it) flight.cancel()
                    viewport = it
                }
        ) {
            Column(
                Modifier.fillMaxSize()
                    .imePadding()
                    .padding(bottom = if (!home && empty) 32.dp else 0.dp)
                    .then(if (home) Modifier.verticalScroll(homeScroll) else Modifier)
            ) {
                if (!home && empty) Spacer(Modifier.weight(1f))
                Box((if (!home && !empty) Modifier.weight(1f) else Modifier).fillMaxWidth()) {
                    when {
                        home -> HomeHeading(s, vm)
                        empty -> ChatGreeting(s)
                        else -> ChatTranscript(s, vm, Modifier.fillMaxSize())
                    }
                }
                Box(
                    Modifier.padding(
                        start = if (home) 16.dp else 12.dp,
                        end = if (home) 16.dp else 12.dp,
                        top = if (home) 0.dp else 8.dp,
                        bottom = if (home) 0.dp else 12.dp,
                    )
                ) {
                    Composer(s, vm, home)
                }
                if (home) {
                    Column(
                        Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        HomeContents(s, vm)
                        if (s.catalog == null || s.profile == null)
                            EpButton("重新读取伙伴设置", vm::refresh, enabled = !s.busy)
                    }
                } else if (empty) Spacer(Modifier.weight(1f))
            }
            SendFlightOverlay(flight, flightOrigin)
        }
    }
}

@Composable
private fun HomeHeading(s: AppState, vm: AppViewModel) {
    Column(
        Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AgentAvatar(
            s.profile?.avatarId ?: "cheng",
            s.profile?.color,
            s.profile?.name ?: "Agent",
            72,
            state = "greet",
        )
        Text(
            webGreeting(s.history.isNotEmpty()),
            style =
                MaterialTheme.typography.headlineLarge.copy(
                    lineHeight = (EverplainTokens.textDisplay * 1.15f).sp
                ),
            modifier = Modifier.padding(top = 8.dp),
        )
        HomeContext(vm)
    }
}

@Composable
private fun ChatGreeting(s: AppState) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AgentAvatar(
            s.profile?.avatarId ?: "cheng",
            s.profile?.color,
            s.profile?.name ?: "Agent",
            96,
            state = "greet",
        )
        Text(
            webGreeting(s.history.isNotEmpty()),
            style =
                MaterialTheme.typography.headlineSmall.copy(
                    lineHeight =
                        (EverplainTokens.textSection * EverplainTokens.textDisplayLineHeight).sp,
                    fontWeight = FontWeight.Medium,
                ),
            modifier = Modifier.padding(top = 16.dp),
        )
    }
}

@Composable
private fun Composer(s: AppState, vm: AppViewModel, home: Boolean = false) {
    val materialController = vm.materials()
    val materialState by materialController.state.collectAsStateWithLifecycle()
    var materialPicker by remember { mutableStateOf(false) }
    var libraryPicker by remember { mutableStateOf(false) }
    val (upload, preparing) =
        rememberMaterialUpload(
            materialController,
            s.streaming || materialState.uploading || materialState.unresolved,
        )
    LaunchedEffect(s.materialScope, s.conversation?.conversationId, s.materialContext) {
        materialController.bind(
            s.materialScope,
            s.conversation?.conversationId ?: s.materialContext?.conversationId,
            s.materialContext?.taskId ?: s.conversation?.taskId,
        )
    }
    FeatureVisibility(
        materialController,
        {
            materialController.bind(
                s.materialScope,
                s.conversation?.conversationId ?: s.materialContext?.conversationId,
                s.materialContext?.taskId ?: s.conversation?.taskId,
            )
        },
        materialController::leave,
    )
    if (materialPicker) MaterialPicker(materialController) { materialPicker = false }
    if (libraryPicker) ReferenceLibraryPicker(vm.library(), s, vm) { libraryPicker = false }

    var tools by remember { mutableStateOf(false) }
    var editorValue by remember {
        mutableStateOf(TextFieldValue(s.draft, androidx.compose.ui.text.TextRange(s.draft.length)))
    }
    LaunchedEffect(s.draft) {
        if (editorValue.text != s.draft)
            editorValue =
                TextFieldValue(s.draft, androidx.compose.ui.text.TextRange(s.draft.length))
    }
    val flight = LocalSendFlight.current
    val motion = rememberMotionEnabled()
    val narrow = LocalConfiguration.current.screenWidthDp <= 480
    val research = s.composerMode == "deep_research"
    var availableWidth by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val multiline =
        s.draft.contains('\n') ||
            s.draft.length > 40 ||
            (availableWidth < with(density) { 480.dp.toPx() } && s.draft.isNotEmpty())
    val panel = narrow || research || multiline || materialState.attached.isNotEmpty()
    val corner = if (panel) EverplainTokens.radiusPanel.dp else EverplainTokens.radiusPill.dp
    val shadows =
        EverplainTokens.shadowComposer(MaterialTheme.colorScheme.background.luminance() < .5f)
    Surface(
        modifier =
            (if (motion)
                    Modifier.animateContentSize(
                        tween(320, easing = CubicBezierEasing(.16f, 1f, .3f, 1f))
                    )
                else Modifier)
                .webShadow(shadows, corner),
        shape =
            RoundedCornerShape(
                if (panel) EverplainTokens.radiusPanel.dp else EverplainTokens.radiusPill.dp
            ),
        color = MaterialTheme.colorScheme.surfaceVariant,
        shadowElevation = 0.dp,
    ) {
        Column(
            Modifier.onSizeChanged { availableWidth = it.width }
                .padding(
                    start = 12.dp,
                    top = if (research) 16.dp else 10.dp,
                    end = if (research) 12.dp else 10.dp,
                    bottom = if (research) 12.dp else 10.dp,
                )
        ) {
            ComposerAttachments(s, materialController)
            if (preparing) Text("正在读取文件…", fontSize = 13.sp)
            ComposerGrid(research = research, narrow = narrow, multiline = multiline) {
                Box {
                    EpIcon(
                        EpIcons.Add,
                        "添加附件",
                        { tools = true },
                        enabled = !materialState.uploading && !preparing,
                    )
                    DropdownMenu(
                        tools,
                        { tools = false },
                        containerColor = MaterialTheme.colorScheme.surfaceContainer,
                        shape = RoundedCornerShape(EverplainTokens.radiusCard.dp),
                    ) {
                        if (home)
                            DropdownMenuItem(
                                text = { Text("导入资料") },
                                onClick = {
                                    tools = false
                                    vm.navigate(Destination.Library)
                                },
                            )
                        else {
                            DropdownMenuItem(
                                text = { Text("上传文件", fontSize = 14.sp) },
                                onClick = {
                                    tools = false
                                    upload()
                                },
                                enabled = !s.streaming && !preparing,
                            )
                            DropdownMenuItem(
                                text = { Text("从研究材料添加", fontSize = 14.sp) },
                                onClick = {
                                    tools = false
                                    materialPicker = true
                                },
                                enabled = !s.streaming,
                            )
                            DropdownMenuItem(
                                text = { Text("参考知识库", fontSize = 14.sp) },
                                onClick = {
                                    tools = false
                                    libraryPicker = true
                                },
                                enabled = !s.streaming,
                            )
                        }
                    }
                }
                BasicTextField(
                    editorValue,
                    { next ->
                        if (!s.streaming) {
                            editorValue = next
                            vm.setDraft(next.text)
                        }
                    },
                    modifier =
                        Modifier.heightIn(min = if (research) 52.dp else 36.dp, max = 240.dp)
                            .padding(
                                horizontal = if (research) 8.dp else 0.dp,
                                vertical = if (research) 0.dp else 5.dp,
                            )
                            .onGloballyPositioned { flight?.editorBounds = it.boundsInRoot() }
                            .onPreviewKeyEvent { event ->
                                if (
                                    event.key == Key.Enter &&
                                        !event.isShiftPressed &&
                                        editorValue.composition == null
                                ) {
                                    if (
                                        event.type == KeyEventType.KeyDown &&
                                            !s.streaming &&
                                            s.pending == null &&
                                            s.draft.isNotBlank()
                                    ) {
                                        flight?.mark(s.draft)
                                        vm.send()
                                    }
                                    true
                                } else false
                            }
                            .semantics {
                                contentDescription =
                                    if (home) "问${s.profile?.name ?: "Agent"}" else "问一个问题"
                            },
                    // Compose readOnly ends the platform input session, unlike the Web
                    // textarea. Keep this editor enabled; setDraft rejects in-flight edits.
                    readOnly = false,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions =
                        KeyboardActions(
                            onSend = {
                                if (
                                    !s.streaming &&
                                        s.pending == null &&
                                        editorValue.composition == null &&
                                        s.draft.isNotBlank()
                                ) {
                                    flight?.mark(s.draft)
                                    vm.send()
                                }
                            }
                        ),
                    textStyle =
                        MaterialTheme.typography.bodyLarge.copy(
                            color = MaterialTheme.colorScheme.onSurface,
                            lineHeight = 26.sp,
                        ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
                    maxLines = 8,
                    decorationBox = { inner ->
                        if (s.draft.isEmpty())
                            Text(
                                if (s.composerMode == "deep_research") "描述你想弄清楚的问题"
                                else if (home) "问${s.profile?.name ?: "Agent"}，或者丢一个链接进来"
                                else "问一个问题",
                                style = MaterialTheme.typography.bodyLarge.copy(lineHeight = 26.sp),
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .7f),
                            )
                        inner()
                    },
                )
                ModelSelector(s, vm)
                EpIcon(
                    if (s.streaming) EpIcons.Stop else EpIcons.ArrowUpward,
                    if (s.streaming) "停止生成" else "发送给 Everplain",
                    if (s.streaming) {
                        {
                            flight?.cancel()
                            vm.stop()
                        }
                    } else {
                        {
                            flight?.mark(s.draft)
                            vm.send()
                        }
                    },
                    primary = true,
                    enabled =
                        if (s.streaming) !s.stopping
                        else
                            s.draft.isNotBlank() &&
                                !materialState.uploading &&
                                !preparing &&
                                materialState.attached.all { it.status == "ready" } &&
                                s.model != null &&
                                s.effort != null &&
                                s.pending == null,
                )
            }
        }
    }
}

@Composable
private fun ModelSelector(s: AppState, vm: AppViewModel, modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }
    val summaryMaxWidth = minOf(260f, LocalConfiguration.current.screenWidthDp * .44f).dp
    val model = s.catalog?.items?.find { it.modelId == (s.pending?.request?.modelId ?: s.model) }
    val effort = s.pending?.request?.reasoningEffort ?: s.effort
    Box(modifier) {
        Row(
            Modifier.heightIn(min = 36.dp)
                .widthIn(max = summaryMaxWidth)
                .clip(CircleShape)
                .background(
                    if (expanded) MaterialTheme.colorScheme.surfaceContainerHighest
                    else Color.Transparent
                )
                .semantics {
                    contentDescription =
                        "模型与思考强度：${model?.label ?: "正在读取模型"} · ${effortLabel(effort)}"
                }
                .clickable { expanded = true }
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                model?.label ?: "正在读取模型",
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (model != null)
                Text(
                    effortLabel(effort),
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            Icon(
                EpIcons.ExpandMore,
                null,
                Modifier.size(12.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DropdownMenu(
            expanded,
            { expanded = false },
            modifier = Modifier.widthIn(min = 260.dp, max = 300.dp),
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
            shape = RoundedCornerShape(EverplainTokens.radiusCard.dp),
        ) {
            Text(
                "模型",
                Modifier.padding(12.dp),
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            s.catalog?.items?.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(choice.label, fontSize = 14.sp) },
                    trailingIcon = {
                        if (choice.modelId == s.model)
                            Icon(EpIcons.Check, null, Modifier.size(18.dp))
                    },
                    onClick = { vm.selectModel(choice.modelId) },
                    enabled = !s.streaming && s.pending == null,
                )
            }
            HorizontalDivider(Modifier.padding(horizontal = 8.dp))
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(
                        "思考强度",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(effortLabel(effort), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
                EffortSlider(
                    model?.reasoningEfforts.orEmpty(),
                    effort,
                    !s.streaming && s.pending == null,
                    vm::selectEffort,
                )
                Text(
                    "越高想得越久，适合需要推理的问题",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            if (s.catalog?.runtimeMode == "mock")
                Text(
                    "当前是隔离测试模型。",
                    Modifier.padding(12.dp),
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            if (s.catalog == null) EpButton("重新读取模型", vm::refresh)
        }
    }
}

@Composable
private fun EffortSlider(
    steps: List<String>,
    selected: String?,
    enabled: Boolean,
    choose: (String) -> Unit,
) {
    if (steps.isEmpty()) return
    val selectedIndex = steps.indexOf(selected).coerceAtLeast(0)
    var preview by remember(steps, selected) { mutableFloatStateOf(selectedIndex.toFloat()) }
    val ink = MaterialTheme.colorScheme.onSurface
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val surface = MaterialTheme.colorScheme.surfaceVariant
    val rail = MaterialTheme.colorScheme.surfaceContainerHighest
    val rule = MaterialTheme.colorScheme.outline
    Column(Modifier.padding(top = 34.dp, start = 10.dp, end = 10.dp)) {
        Slider(
            value = preview,
            onValueChange = { preview = it },
            onValueChangeFinished = { choose(steps[preview.roundToInt().coerceIn(steps.indices)]) },
            valueRange = 0f..maxOf(1, steps.lastIndex).toFloat(),
            steps = (steps.size - 2).coerceAtLeast(0),
            enabled = enabled && steps.size > 1,
            modifier =
                Modifier.fillMaxWidth().height(24.dp).semantics {
                    contentDescription = "思考强度"
                    stateDescription =
                        effortLabel(steps[preview.roundToInt().coerceIn(steps.indices)])
                },
            thumb = {
                Surface(
                    shape = CircleShape,
                    color = surface,
                    shadowElevation = 2.dp,
                    border = BorderStroke(1.dp, rule),
                    modifier = Modifier.size(22.dp),
                ) {}
            },
            track = {
                Canvas(Modifier.fillMaxWidth().height(24.dp)) {
                    val y = size.height / 2
                    val ratio = if (steps.size > 1) preview / steps.lastIndex else 0f
                    drawLine(
                        rail,
                        Offset(0f, y),
                        Offset(size.width, y),
                        6.dp.toPx(),
                        StrokeCap.Round,
                    )
                    drawLine(
                        ink,
                        Offset(0f, y),
                        Offset(size.width * ratio, y),
                        6.dp.toPx(),
                        StrokeCap.Round,
                    )
                    steps.indices.forEach { index ->
                        val x = if (steps.size > 1) size.width * index / steps.lastIndex else 0f
                        drawCircle(
                            if (index <= preview.roundToInt()) surface else muted,
                            2.dp.toPx(),
                            Offset(x, y),
                        )
                    }
                }
            },
        )
        Row(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            steps.forEachIndexed { index, value ->
                Text(
                    effortLabel(value),
                    fontSize = 13.sp,
                    color = if (index == selectedIndex) ink else muted,
                    fontWeight =
                        if (index == selectedIndex) FontWeight.SemiBold else FontWeight.Normal,
                    modifier =
                        Modifier.clickable(enabled = enabled) { choose(value) }
                            .padding(vertical = 2.dp),
                )
            }
        }
    }
}

private fun effortLabel(value: String?) =
    when (value) {
        "none" -> "无"
        "minimal" -> "极简"
        "low" -> "低"
        "medium" -> "中"
        "high" -> "高"
        "xhigh" -> "很高"
        "max" -> "最高"
        else -> value ?: "思考强度"
    }

private data class DisplayTurn(
    val key: String,
    val question: String,
    val answer: String,
    val citations: List<AgentCitationResponse>,
    val pending: Boolean,
    val signals: app.everplain.core.NativeTurnSignals = app.everplain.core.NativeTurnSignals(),
)

@Composable
private fun ChatTranscript(s: AppState, vm: AppViewModel, modifier: Modifier) {
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(s.conversation?.turns?.size, s.pending?.partial?.length) {
        if (
            listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let {
                it >= listState.layoutInfo.totalItemsCount - 2
            } != false && listState.layoutInfo.totalItemsCount > 0
        )
            listState.animateScrollToItem(listState.layoutInfo.totalItemsCount - 1)
    }
    LazyColumn(
        modifier.fillMaxWidth(),
        state = listState,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(32.dp),
    ) {
        val entries =
            s.conversation?.turns.orEmpty().map { turn ->
                DisplayTurn(
                    s.turnKeys[turn.turnId] ?: turn.turnId,
                    turn.user.content,
                    turn.assistant.content,
                    turn.assistant.citations.orEmpty(),
                    false,
                    s.turnSignals[turn.turnId] ?: app.everplain.core.canonicalSignals(turn),
                )
            } +
                listOfNotNull(
                    s.pending?.let {
                        DisplayTurn(
                            "pending:${it.key}",
                            it.request.message,
                            it.partial,
                            it.signals.citations,
                            true,
                            it.signals,
                        )
                    }
                )
        items(entries, key = { it.key }) { turn ->
            Column(verticalArrangement = Arrangement.spacedBy(32.dp)) {
                UserQuestion(turn.question, newlySubmitted = turn.pending)
                ResearchFlow(turn.signals, turn.pending && s.streaming, turn.pending, vm)
                AssistantAnswer(
                    s.profile,
                    turn.answer,
                    streaming = turn.pending && s.streaming,
                    status = if (turn.pending) s.status else null,
                    citations = turn.citations,
                    onCitation = vm::selectCitation,
                    regenerate =
                        if (turn.pending || s.streaming || s.pending != null) null
                        else {
                            { vm.regenerate(turn.question) }
                        },
                ) {
                    if (turn.signals.research.stage == "idle")
                        ConversationActivity(turn.signals.tools, turn.pending && s.streaming)
                    if (
                        turn.pending && !s.streaming && turn.signals.research.waitingState == null
                    ) {
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            EpButton("核对状态", vm::checkPending, enabled = !s.busy && !s.stopping)
                            EpButton("恢复回答", vm::resume, enabled = !s.busy && !s.stopping)
                            EpButton("重试停止", vm::stop, enabled = !s.stopping)
                        }
                        Text(
                            "核对状态不会继续生成；恢复回答会继续原请求，可能产生用量。",
                            fontSize = EverplainTokens.textMeta.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun UserQuestion(text: String, newlySubmitted: Boolean = false) {
    val flight = LocalSendFlight.current
    val motion = rememberMotionEnabled()
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Surface(
            modifier =
                Modifier.widthIn(max = maxWidth * .8f)
                    .onGloballyPositioned {
                        if (newlySubmitted) flight?.consume(text, it.boundsInRoot(), motion)
                    }
                    .graphicsLayer {
                        alpha =
                            if (newlySubmitted && flight?.flight?.launch?.text == text.trim()) 0f
                            else 1f
                    },
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            shape = RoundedCornerShape(EverplainTokens.radiusField.dp),
        ) {
            SelectionContainer {
                Text(
                    text,
                    Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

@Composable
private fun AssistantAnswer(
    profile: AgentProfileResponse?,
    text: String,
    streaming: Boolean = false,
    status: String? = null,
    citations: List<AgentCitationResponse> = emptyList(),
    regenerate: (() -> Unit)? = null,
    onCitation: ((AgentCitationResponse) -> Unit)? = null,
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    val paced = rememberPacedText(text, streaming)
    // Exact ConversationThread anatomy: 32px Bot column, 16px gap, no role/name headings.
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        AgentAvatar(
            profile?.avatarId ?: "cheng",
            profile?.color,
            profile?.name ?: "Everplain",
            32,
            state = if (!streaming) "idle" else if (text.isNotEmpty()) "work" else "think",
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (streaming || paced.visible.isNotEmpty())
                Column {
                    ThinkingStatus(streaming && paced.visible.isEmpty(), status ?: "正在思考")
                    if (paced.visible.isNotEmpty())
                        NativeMarkdown(
                            paced.visible,
                            revealedAt = paced.revealedAt,
                            revealColor = profile?.color,
                        )
                }
            if (!streaming && status != null)
                Text(
                    status,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            if (citations.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    citations.forEachIndexed { index, citation ->
                        Surface(
                            modifier =
                                Modifier.clickable(enabled = onCitation != null) {
                                    onCitation?.invoke(citation)
                                },
                            shape = RoundedCornerShape(999.dp),
                            color = Color.Transparent,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        ) {
                            Row(
                                Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Surface(
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.primary,
                                ) {
                                    Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                                        Text(
                                            "${index + 1}",
                                            fontSize = 13.sp,
                                            color = MaterialTheme.colorScheme.onPrimary,
                                        )
                                    }
                                }
                                Text(
                                    citation.label,
                                    fontSize = 13.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
            extra()
            if (!streaming && text.isNotEmpty()) {
                val clipboard = LocalClipboardManager.current
                var copied by remember(text) { mutableStateOf(false) }
                LaunchedEffect(copied) {
                    if (copied) {
                        kotlinx.coroutines.delay(1600)
                        copied = false
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(
                        Modifier.offset(x = (-8).dp)
                            .size(32.dp)
                            .clip(CircleShape)
                            .clickable {
                                clipboard.setText(AnnotatedString(text))
                                copied = true
                            }
                            .semantics { contentDescription = if (copied) "已复制" else "复制回答" },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (copied) EpIcons.Check else EpIcons.ContentCopy,
                            null,
                            Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (regenerate != null) EpIcon(EpIcons.Refresh, "重新生成", regenerate)
                }
            }
        }
    }
}

@Composable
private fun HistoryScreen(s: AppState, vm: AppViewModel) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("你的对话", style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = vm::refresh, enabled = !s.busy) {
                    Icon(EpIcons.Refresh, "刷新历史")
                }
            }
        }
        if (s.recoveries.isNotEmpty())
            item {
                Text("待核对的请求", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        items(s.recoveries, key = { "recovery:${it.key}" }) { record ->
            EpButton(record.request.message.take(44), { vm.openRecovery(record.key) })
        }
        if (s.history.isEmpty())
            item {
                Text(
                    if (s.busy) "正在读取对话…" else "还没有对话。从一个问题开始吧。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        items(s.history, key = { it.conversationId }) {
            HistoryRow(it) { vm.openConversation(it.conversationId) }
        }
    }
}

@Composable
private fun HistoryRow(item: AgentConversationSummaryResponse, open: () -> Unit) {
    Surface(
        onClick = open,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    item.title,
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${item.turnCount} 轮 · ${dateLabel(item.updatedAt)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Icon(EpIcons.ChevronRight, null)
        }
    }
}

private fun dateLabel(value: String): String =
    runCatching {
            DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm")
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(value))
        }
        .getOrDefault(value)

@Composable
private fun AccountScreen(s: AppState, vm: AppViewModel) {
    val controller = vm.accountSettings()
    val settings by controller.state.collectAsStateWithLifecycle()
    LaunchedEffect(controller) { controller.load() }
    var section by rememberSaveable { mutableStateOf(s.accountSection) }
    LaunchedEffect(s.accountSection) { section = s.accountSection }
    val accountScroll = rememberLazyListState()
    LaunchedEffect(section) { accountScroll.scrollToItem(0) }
    var confirmLogout by remember { mutableStateOf(false) }
    var confirmLocal by remember { mutableStateOf(false) }
    var editingName by rememberSaveable { mutableStateOf(false) }
    var draftName by rememberSaveable { mutableStateOf(s.account?.displayName.orEmpty()) }
    var nameVersion by rememberSaveable { mutableLongStateOf(s.account?.version ?: 0) }
    LaunchedEffect(s.account?.version, s.error) {
        if (editingName && s.error == null && s.account?.version != nameVersion && !s.busy)
            editingName = false
    }
    if (confirmLogout || confirmLocal)
        AlertDialog(
            onDismissRequest = {
                confirmLogout = false
                confirmLocal = false
            },
            title = { Text(if (confirmLocal) "仅退出这台设备？" else "退出登录？") },
            text = { Text(if (confirmLocal) "将移除本机加密凭据。服务器上的会话仍可能有效。" else "将撤销当前服务器会话，并移除本机凭据。") },
            confirmButton = {
                EpButton(
                    "退出",
                    {
                        vm.logout(confirmLocal)
                        confirmLogout = false
                        confirmLocal = false
                    },
                    primary = true,
                )
            },
            dismissButton = {
                EpButton(
                    "取消",
                    {
                        confirmLogout = false
                        confirmLocal = false
                    },
                )
            },
        )
    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        state = accountScroll,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { SettingsCategory(section, vm) { section = it } }
        item { AccountSettingsFeedback(controller) }
        when (section) {
            "个人资料" -> {
                item {
                    Column(
                        Modifier.padding(horizontal = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        SettingColumn("显示名称", compact = true) {
                            if (editingName) {
                                EpField("显示名称", draftName, { draftName = it.take(80) })
                                if (s.error != null && s.account?.version != nameVersion) {
                                    Text(
                                        "最新名称：${s.account?.displayName.orEmpty()}",
                                        fontSize = 13.sp,
                                    )
                                    EpButton(
                                        "保留我的修改，继续编辑",
                                        {
                                            nameVersion = s.account?.version ?: nameVersion
                                            vm.clearError()
                                        },
                                    )
                                }
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.End,
                                ) {
                                    EpButton("取消", { editingName = false })
                                    EpButton(
                                        "保存资料",
                                        { vm.saveAccountName(draftName, nameVersion) },
                                        primary = true,
                                        enabled = !s.busy && draftName.isNotBlank(),
                                    )
                                }
                            } else
                                Row(
                                    Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        s.account?.displayName
                                            ?: s.session?.user?.displayName
                                            ?: "研究者",
                                        Modifier.weight(1f),
                                        fontSize = 14.sp,
                                    )
                                    EpButton(
                                        "修改",
                                        {
                                            draftName = s.account?.displayName.orEmpty()
                                            nameVersion = s.account?.version ?: 0
                                            editingName = true
                                        },
                                        secondary = true,
                                    )
                                }
                        }
                        SettingColumn("邮箱", compact = true) {
                            SelectionContainer {
                                Text(
                                    s.account?.email ?: s.session?.user?.email.orEmpty(),
                                    fontSize = 14.sp,
                                )
                            }
                            Text(
                                "变更请联系管理员",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "账户类型",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                if (s.account?.role == "admin") "管理员" else "个人账户",
                                fontSize = 14.sp,
                            )
                        }
                        Column(
                            Modifier.weight(1.5f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "加入时间",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(s.account?.createdAt?.let(::dateLabel) ?: "暂无记录", fontSize = 14.sp)
                        }
                    }
                }
            }
            "使用情况" -> {
                if (s.credits?.isUnlimited == false)
                    item { CreditRedemptionField(controller, vm::refresh) }
                item {
                    SettingColumn("剩余使用额度") {
                        val credits = s.credits
                        if (credits?.isUnlimited == true)
                            Text("不限量", style = MaterialTheme.typography.titleMedium)
                        else {
                            val buckets =
                                credits?.activeUsageBuckets.orEmpty().filter {
                                    it.kind in setOf("welcome", "subscription", "top_up") &&
                                        (it.expiresAt == null ||
                                            runCatching {
                                                    Instant.parse(it.expiresAt)
                                                        .isAfter(Instant.now())
                                                }
                                                .getOrDefault(false))
                                }
                            if (buckets.isEmpty())
                                Text(
                                    "额度信息暂不可用",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            buckets.forEach { bucket ->
                                val settled =
                                    bucket.settledRemainingPoints
                                        ?: if (
                                            credits?.activeUsageBuckets?.size == 1 &&
                                                bucket.kind == "welcome"
                                        )
                                            credits.balance.toDouble()
                                        else bucket.availablePoints.toDouble()
                                val percent =
                                    if (
                                        settled.isFinite() &&
                                            settled >= 0 &&
                                            bucket.limitPoints > 0 &&
                                            settled <= bucket.limitPoints
                                    )
                                        kotlin.math.round(settled / bucket.limitPoints * 10000) /
                                            100
                                    else null
                                val label =
                                    when (bucket.kind) {
                                        "subscription" -> "套餐额度"
                                        "top_up" -> "额外购买额度"
                                        else -> "赠送额度"
                                    }
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(label, fontSize = 14.sp)
                                    Text(
                                        percent?.let { "$it%" } ?: "暂不可用",
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                    )
                                }
                                if (percent != null)
                                    LinearProgressIndicator(
                                        progress = { (percent / 100).toFloat() },
                                        modifier = Modifier.fillMaxWidth().height(4.dp),
                                        color = MaterialTheme.colorScheme.onSurface,
                                        trackColor =
                                            MaterialTheme.colorScheme.surfaceContainerHighest,
                                    )
                                bucket.expiresAt?.let {
                                    Text(
                                        "有效至 ${dateLabel(it)}",
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("用量记录", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "共 ${s.credits?.totalEntries ?: 0} 笔",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                items(s.credits?.entries.orEmpty(), key = { it.entryId }) { entry ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                if (entry.kind == "usage") "Agent 对话"
                                else if (entry.kind == "redemption") "兑换码到账" else "新用户赠送",
                                fontSize = 14.sp,
                            )
                            Text(
                                dateLabel(entry.createdAt),
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text("${entry.points}", fontSize = 14.sp)
                    }
                }
            }
            "使用偏好",
            "安全",
            "数据与隐私",
            "账户状态",
            "聊天平台" -> {
                item { AccountAdditionalSection(section, s, vm, controller) }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                EpButton("退出登录", { confirmLogout = true }, enabled = !s.busy && !s.streaming)
            }
        }
        if (s.error != null)
            item {
                EpButton("连接失败时，仅退出本机", { confirmLocal = true }, enabled = !s.busy && !s.streaming)
            }
    }
}

@Composable
private fun SettingColumn(
    label: String,
    compact: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = if (compact) 4.dp else 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        content()
    }
}

@Composable
private fun KeyValue(label: String, value: String) {
    Column(Modifier.padding(vertical = 6.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SelectionContainer { Text(value) }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            content()
        }
    }
}

@Composable
private fun AgentSettings(s: AppState, vm: AppViewModel) {
    val p = s.profile
    if (p == null) {
        Column(Modifier.padding(16.dp)) {
            Text("正在读取 Agent 设置…")
            EpButton("重试", vm::refresh)
        }
        return
    }
    val draft = vm.agentDraft(p)
    var expectedVersion by draft.expectedVersion
    var name by draft.name
    var style by draft.style
    var soul by draft.soul
    var avatar by draft.avatar
    var color by draft.color
    var saved by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val colors =
        listOf(
            "#5d8fe6",
            "#ec8a52",
            "#3fae9c",
            "#e55f6f",
            "#de6aa5",
            "#9a80e0",
            "#eeb146",
            "#3d3d3a",
        )
    LaunchedEffect(s.settingsSaved) {
        if (s.settingsSaved > 0) {
            saved = true
            expectedVersion = p.version
        }
    }
    LazyColumn(
        Modifier.fillMaxSize().imePadding(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { SettingsCategory("我的 Agent", vm) }
        item {
            Row(
                Modifier.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AgentAvatar(avatar, color, "Agent 预览", 64, state = "greet")
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    avatarNames.chunked(4).forEachIndexed { row, values ->
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            values.forEachIndexed { col, (id, label) ->
                                Box(
                                    Modifier.size(44.dp)
                                        .clip(RoundedCornerShape(14.dp))
                                        .then(
                                            if (avatar == id)
                                                Modifier.border(
                                                    2.dp,
                                                    MaterialTheme.colorScheme.onSurface,
                                                    RoundedCornerShape(14.dp),
                                                )
                                            else Modifier
                                        )
                                        .clickable(enabled = !s.busy) {
                                            avatar = id
                                            color = colors[row * 4 + col]
                                            saved = false
                                        }
                                        .semantics {
                                            contentDescription = label
                                            selected = avatar == id
                                        },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    AgentAvatar(
                                        id,
                                        if (avatar == id) color else colors[row * 4 + col],
                                        label,
                                        32,
                                        playing = false,
                                    )
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(0.dp))
                    colors.chunked(4).forEach { choices ->
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            choices.forEach { value ->
                                Box(
                                    Modifier.size(44.dp)
                                        .clip(CircleShape)
                                        .clickable(enabled = !s.busy) {
                                            color = value
                                            saved = false
                                        }
                                        .semantics {
                                            contentDescription = "颜色 $value"
                                            selected = color.equals(value, true)
                                        },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Box(
                                        Modifier.size(
                                                if (color.equals(value, true)) 32.dp else 24.dp
                                            )
                                            .then(
                                                if (color.equals(value, true))
                                                    Modifier.border(
                                                            2.dp,
                                                            MaterialTheme.colorScheme.onSurface,
                                                            CircleShape,
                                                        )
                                                        .padding(4.dp)
                                                else Modifier
                                            )
                                            .background(
                                                Color(android.graphics.Color.parseColor(value)),
                                                CircleShape,
                                            )
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        item {
            EpField(
                "名字",
                name,
                {
                    name = it.take(40)
                    saved = false
                },
                enabled = !s.busy,
            )
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("说话方式", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHighest,
                ) {
                    Column(
                        Modifier.padding(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        listOf(
                                "clear" to "清晰直接",
                                "warm" to "温和自然",
                                "rigorous" to "严谨细致",
                                "curious" to "好奇开放",
                            )
                            .chunked(2)
                            .forEach { choices ->
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    choices.forEach { (value, label) ->
                                        EpButton(
                                            label,
                                            {
                                                style = value
                                                saved = false
                                            },
                                            selected = style == value,
                                            enabled = !s.busy,
                                            modifier = Modifier.weight(1f),
                                        )
                                    }
                                }
                            }
                    }
                }
            }
        }
        item {
            EpField(
                "人格描述（Markdown）",
                soul,
                {
                    soul = it.take(8000)
                    saved = false
                },
                minHeight = 180,
                multiline = true,
                enabled = !s.busy,
            )
        }
        item {
            Text(
                "用自己的话写身份、交流方式、偏好与边界。支持 Markdown；上面的风格只是起点。",
                fontSize = 13.sp,
                lineHeight = 19.5.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (s.settingsConflict)
            item {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("另一处已保存了新版本。你的草稿仍在编辑框内，先核对下面的最新档案。", fontSize = 14.sp)
                    if (!s.settingsConflictReady)
                        EpButton("重新读取最新设置", vm::refresh, enabled = !s.busy)
                    Text(
                        "最新身份与风格",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "${p.name} · ${p.avatarId} · ${p.color} · ${p.speakingStyle}",
                        fontSize = 14.sp,
                    )
                    Text(
                        "最新人格描述",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(p.soulText ?: "未填写", fontSize = 14.sp)
                    EpButton(
                        "保留我的修改继续编辑",
                        {
                            expectedVersion = p.version
                            vm.acknowledgeConflict()
                        },
                        enabled = s.settingsConflictReady,
                    )
                    EpButton(
                        "采用最新版本",
                        {
                            name = p.name
                            style = p.speakingStyle
                            soul = p.soulText.orEmpty()
                            avatar = p.avatarId
                            color = p.color
                            expectedVersion = p.version
                            vm.acknowledgeConflict()
                        },
                        enabled = s.settingsConflictReady,
                    )
                }
            }
        item {
            if (discard)
                Column {
                    Text("放弃当前未保存的修改，恢复已保存的档案？", fontSize = 14.sp)
                    EpButton(
                        "放弃未保存的修改",
                        {
                            name = p.name
                            style = p.speakingStyle
                            soul = p.soulText.orEmpty()
                            avatar = p.avatarId
                            color = p.color
                            expectedVersion = p.version
                            discard = false
                        },
                    )
                    EpButton("继续编辑", { discard = false })
                }
            else EpButton("取消修改", { discard = true }, enabled = !s.busy)
        }
        item {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (saved) Text("已保存", fontSize = 13.sp, modifier = Modifier.padding(end = 8.dp))
                EpButton(
                    if (s.busy) "正在保存…" else "保存 Agent",
                    { vm.saveProfile(name, style, soul, avatar, color, expectedVersion) },
                    primary = true,
                    enabled = !s.busy && !s.settingsConflict && name.isNotBlank(),
                )
            }
        }
    }
}

@Composable
private fun SettingsCategory(
    current: String,
    vm: AppViewModel,
    select: ((String) -> Unit)? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Surface(
            onClick = { expanded = true },
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            shape = RoundedCornerShape(999.dp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        ) {
            Row(
                Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(current, Modifier.weight(1f), fontSize = 14.sp)
                Icon(EpIcons.ExpandMore, null, Modifier.size(16.dp))
            }
        }
        DropdownMenu(
            expanded,
            { expanded = false },
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
            shape = RoundedCornerShape(EverplainTokens.radiusCard.dp),
        ) {
            listOf("我的 Agent", "聊天平台", "个人资料", "使用情况", "使用偏好", "安全", "数据与隐私", "账户状态").forEach {
                label ->
                DropdownMenuItem(
                    text = { Text(label, fontSize = 14.sp) },
                    onClick = {
                        expanded = false
                        if (label == "我的 Agent") vm.navigate(Destination.Agent)
                        else {
                            if (select == null) vm.navigate(Destination.Account)
                            select?.invoke(label)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun ErrorCard(
    message: String,
    modifier: Modifier = Modifier,
    dismiss: (() -> Unit)? = null,
) {
    Surface(
        modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(14.dp),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                message,
                Modifier.weight(1f),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (dismiss != null) IconButton(onClick = dismiss) { Icon(EpIcons.Close, "关闭提示") }
        }
    }
}

@Composable
internal fun EpButton(
    label: String,
    onClick: () -> Unit,
    primary: Boolean = false,
    selected: Boolean = false,
    secondary: Boolean = false,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val color =
        if (primary) MaterialTheme.colorScheme.primary
        else if (selected || secondary) MaterialTheme.colorScheme.surfaceVariant
        else Color.Transparent
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(999.dp),
        color = color,
        border = if (secondary) BorderStroke(1.dp, MaterialTheme.colorScheme.outline) else null,
        modifier = modifier.heightIn(min = 44.dp).alpha(if (enabled) 1f else .45f),
    ) {
        Text(
            label,
            Modifier.padding(horizontal = 16.dp, vertical = 11.dp),
            textAlign = TextAlign.Center,
            fontSize = 14.sp,
            lineHeight = 21.sp,
            fontWeight = FontWeight(550),
            color =
                (if (primary) MaterialTheme.colorScheme.onPrimary
                else MaterialTheme.colorScheme.onSurface),
        )
    }
}

@Composable
internal fun EpIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
    primary: Boolean = false,
    enabled: Boolean = true,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = if (primary) MaterialTheme.colorScheme.primary else Color.Transparent,
        modifier =
            Modifier.size(36.dp).alpha(if (enabled) 1f else if (primary) .25f else .45f).semantics {
                contentDescription = label
            },
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                icon,
                null,
                Modifier.size(if (primary) 16.1.dp else 18.dp),
                tint =
                    if (primary) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
internal fun EpField(
    label: String,
    value: String,
    change: (String) -> Unit,
    minHeight: Int = 48,
    multiline: Boolean = false,
    enabled: Boolean = true,
    minLines: Int = if (multiline) 7 else 1,
    monospace: Boolean = multiline,
    showLabel: Boolean = true,
    labelSize: Float = 13f,
    placeholder: String? = null,
    password: Boolean = false,
) {
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val shape = RoundedCornerShape(if (multiline) 24.dp else 999.dp)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showLabel)
            Text(
                label,
                fontSize = labelSize.sp,
                lineHeight = (labelSize * 1.5f).sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        BasicTextField(
            value,
            change,
            enabled = enabled,
            singleLine = !multiline,
            visualTransformation =
                if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = if (password) KeyboardType.Password else KeyboardType.Text,
                    autoCorrectEnabled = !password,
                ),
            minLines = minLines,
            interactionSource = interactions,
            textStyle =
                MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                    fontFamily = if (monospace) FontFamily.Monospace else FontFamily.SansSerif,
                ),
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty() && placeholder != null)
                        Text(
                            placeholder,
                            style = MaterialTheme.typography.bodyLarge,
                            color =
                                EverplainTokens.colorFaint(
                                        MaterialTheme.colorScheme.background.luminance() < .5f
                                    )
                                    .compose(),
                        )
                    inner()
                }
            },
            cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface),
            modifier =
                Modifier.fillMaxWidth()
                    .heightIn(min = minHeight.dp)
                    .background(
                        if (focused) MaterialTheme.colorScheme.surfaceVariant
                        else MaterialTheme.colorScheme.surfaceContainerHighest,
                        shape,
                    )
                    .then(
                        if (focused)
                            Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, shape)
                        else Modifier
                    )
                    .padding(horizontal = 20.dp, vertical = if (multiline) 16.dp else 11.dp)
                    .semantics { contentDescription = label },
        )
    }
}

private fun webGreeting(hasHistory: Boolean): String {
    val now = java.time.LocalDateTime.now()
    val pool =
        when (now.hour) {
            in 6..10 -> listOf("太阳已到岗。", "来啦。", "这么巧，你也在。", "恭候多时。")
            in 11..13 -> listOf("偷得浮生半日闲。", "来啦。", "这么巧，你也在。", "恭候多时。")
            in 14..17 -> listOf("来啦。", "这么巧，你也在。", "恭候多时。")
            in 18..22 -> listOf("今晚我值班。", "来啦。", "这么巧，你也在。", "恭候多时。")
            else -> listOf("月亮值班中。", "夜猫子，集合。", "今晚我值班。", "恭候多时。")
        }
    val choices = if (hasHistory) pool + listOf("你回来啦。", "别来无恙。") else pool
    return choices[(now.year * 372 + (now.monthValue - 1) * 31 + now.dayOfMonth) % choices.size]
}
