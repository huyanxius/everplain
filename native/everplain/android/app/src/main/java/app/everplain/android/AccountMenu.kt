package app.everplain.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.everplain.shared.*
import java.time.Instant

/** Web AccountMenu and its separate local notification control; no invented notifications API. */
@Composable
internal fun DrawerAccount(
    s: AppState,
    vm: AppViewModel,
    openIdentity: (String) -> Unit,
    closeDrawer: () -> Unit,
) {
    val uri = LocalUriHandler.current
    var open by remember { mutableStateOf(false) }
    var notifications by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf("all") }
    val accountName =
        s.session?.user?.displayName?.takeIf { it.isNotBlank() } ?: s.session?.user?.email.orEmpty()
    val name = s.profile?.name?.takeIf { it.isNotBlank() } ?: "Agent"
    Row(
        Modifier.fillMaxWidth().padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(Modifier.weight(1f)) {
            Row(
                Modifier.fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable {
                        open = !open
                        if (open) vm.loadAccountMenu()
                    }
                    .semantics { contentDescription = "账户 $accountName" }
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AgentAvatar(s.profile?.avatarId ?: "cheng", s.profile?.color, name, 32)
                Text(
                    name,
                    Modifier.weight(1f),
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(NavIcons.Chevron, null, Modifier.size(18.dp))
            }
            DropdownMenu(
                open,
                { open = false },
                modifier = Modifier.width(260.dp),
                shape = RoundedCornerShape(20.dp),
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(
                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        AgentAvatar(s.profile?.avatarId ?: "cheng", s.profile?.color, name, 32)
                        Column {
                            Text(
                                accountName,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            val current = s.subscription?.subscription
                            val plan =
                                when {
                                    s.planUnavailable -> "套餐信息暂不可用"
                                    s.subscription == null -> "正在读取套餐…"
                                    current == null -> "未订阅"
                                    else ->
                                        s.subscription.plans.find { it.id == current.planId }?.name
                                            ?: "套餐信息待确认"
                                }
                            val status =
                                when (current?.status) {
                                    "trialing" -> "试用中"
                                    "past_due" -> "付款逾期"
                                    "canceled" -> "已取消"
                                    "unpaid" -> "未付款"
                                    "incomplete" -> "待完成付款"
                                    "incomplete_expired" -> "已过期"
                                    "paused" -> "已暂停"
                                    "active",
                                    null -> null
                                    else -> "状态待确认"
                                }
                            Text(
                                plan + (status?.let { " · $it" }.orEmpty()),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    AccountAllowances(s.credits, s.usageUnavailable)
                }
                fun choose(action: () -> Unit) {
                    open = false
                    action()
                }
                AccountMenuItem("Soul · 人格", NavIcons.User) { choose { openIdentity("identity") } }
                AccountMenuItem("Memory · 记忆", NavIcons.Library) {
                    choose { openIdentity("memory") }
                }
                AccountMenuItem("使用情况", NavIcons.Graph) {
                    choose {
                        vm.openAccountSection("使用情况")
                        closeDrawer()
                    }
                }
                // The Web's subscription route is also reachable here; show the real plan state.
                AccountMenuItem("升级套餐 · 网页", NavIcons.Card) {
                    choose { uri.openUri(s.origin.trimEnd('/') + "/subscription") }
                }
                AccountMenuItem("设置", NavIcons.Settings) {
                    choose {
                        vm.openAccountSection("个人资料")
                        closeDrawer()
                    }
                }
            }
        }
        Box {
            EpIcon(NavIcons.Bell, "通知", { notifications = !notifications })
            DropdownMenu(
                notifications,
                { notifications = false },
                modifier = Modifier.width(320.dp),
                shape = RoundedCornerShape(20.dp),
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "通知",
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        EpIcon(NavIcons.Close, "关闭通知", { notifications = false })
                    }
                    Row(
                        Modifier.fillMaxWidth()
                            .background(
                                MaterialTheme.colorScheme.surfaceContainerHighest,
                                CircleShape,
                            )
                            .padding(4.dp)
                    ) {
                        listOf("all" to "全部", "updates" to "更新日志", "messages" to "消息").forEach {
                            (value, title) ->
                            Box(
                                Modifier.weight(1f)
                                    .clip(CircleShape)
                                    .background(
                                        if (value == filter)
                                            MaterialTheme.colorScheme.surfaceVariant
                                        else androidx.compose.ui.graphics.Color.Transparent
                                    )
                                    .clickable { filter = value }
                                    .padding(vertical = 10.dp)
                                    .semantics {
                                        role = Role.Tab
                                        selected = value == filter
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(title, fontSize = 14.sp)
                            }
                        }
                    }
                    if (filter != "messages") {
                        Text("深度研究现已上线", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(
                            "选择深度研究，自动让 Agent 规划任务，检索你的知识库并阅读网页。你可以查看来源，在文稿中继续编辑结果。",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    if (filter != "updates")
                        Text("暂无新消息", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        }
    }
}

@Composable
private fun AccountMenuItem(text: String, icon: ImageVector, click: () -> Unit) {
    DropdownMenuItem(
        text = { Text(text, fontSize = 14.sp) },
        leadingIcon = { Icon(icon, null, Modifier.size(20.dp)) },
        onClick = click,
        modifier = Modifier.heightIn(min = 40.dp),
    )
}

@Composable
internal fun AccountAllowances(credits: CreditSummaryResponse?, unavailable: Boolean = false) {
    val buckets =
        if (unavailable || credits?.isUnlimited == true) emptyList()
        else
            credits?.activeUsageBuckets.orEmpty().filter {
                it.kind in setOf("welcome", "subscription", "top_up") &&
                    (it.expiresAt == null ||
                        runCatching { Instant.parse(it.expiresAt).isAfter(Instant.now()) }
                            .getOrDefault(false))
            }
    if (buckets.isEmpty())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("使用额度", fontSize = 14.sp)
            Text(
                when {
                    unavailable -> "额度信息暂不可用"
                    credits == null -> "正在读取…"
                    credits.isUnlimited == true -> "不限量"
                    else -> "额度信息暂不可用"
                },
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    buckets.forEach { bucket ->
        val settled =
            bucket.settledRemainingPoints
                ?: if (credits?.activeUsageBuckets?.size == 1 && bucket.kind == "welcome")
                    credits.balance.toDouble()
                else bucket.availablePoints.toDouble()
        val percent =
            if (
                settled.isFinite() &&
                    settled >= 0 &&
                    bucket.limitPoints > 0 &&
                    settled <= bucket.limitPoints
            )
                kotlin.math.round(settled / bucket.limitPoints * 10000) / 100
            else null
        val label =
            when (bucket.kind) {
                "subscription" -> "套餐额度"
                "top_up" -> "额外购买额度"
                else -> "赠送额度"
            }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(label, fontSize = 14.sp)
                Text(
                    percent?.let { "剩余 $it%" } ?: "暂不可用",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (percent != null)
                Box(
                    Modifier.fillMaxWidth()
                        .height(8.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                        .semantics {
                            contentDescription = "${label}剩余"
                            progressBarRangeInfo = ProgressBarRangeInfo(percent.toFloat(), 0f..100f)
                        }
                ) {
                    Box(
                        Modifier.fillMaxWidth((percent / 100).toFloat())
                            .fillMaxHeight()
                            .background(MaterialTheme.colorScheme.onSurface, CircleShape)
                    )
                }
        }
    }
}

@Composable
internal fun DrawerNavRow(label: String, icon: ImageVector, selected: Boolean, click: () -> Unit) {
    Row(
        Modifier.padding(horizontal = 8.dp)
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(
                if (selected) MaterialTheme.colorScheme.surfaceContainerHighest
                else androidx.compose.ui.graphics.Color.Transparent
            )
            .clickable(onClick = click)
            .padding(horizontal = 8.dp)
            .semantics { this.selected = selected },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, Modifier.size(18.dp))
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.Normal)
    }
}
