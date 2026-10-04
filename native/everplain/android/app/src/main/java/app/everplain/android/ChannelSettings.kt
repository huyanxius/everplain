package app.everplain.android

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.core.*
import app.everplain.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

@Composable
internal fun ChannelSettings(c: ChannelController) {
    val s by c.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var confirm by remember { mutableStateOf<ChannelBindingResponse?>(null) }
    FeatureVisibility(c, c::enter, c::leave)
    LaunchedEffect(s.bindings) {
        if (confirm != null && s.bindings.none { it.bindingId == confirm?.bindingId })
            confirm = null
    }
    val target = s.gateways.find { it.gatewayId == s.selected }
    Text(
        "在飞书或 Telegram 私聊中使用你的 Everplain Agent。群聊和附件暂未开放。",
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (s.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    s.error?.let { LibraryNotice(it, true, "刷新状态", c::refresh) }
    s.feedback?.let { Text(it, fontSize = 13.sp) }
    if (s.gateways.isNotEmpty()) {
        SettingsChoice(
            "选择机器人",
            s.selected,
            s.gateways.map { it.gatewayId to it.name },
            !s.busy,
            c::select,
        )
        target?.let {
            Text(it.gatewayId, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(verticalAlignment = Alignment.Top) {
            Checkbox(s.consent, c::consent, enabled = !s.busy)
            Text("我理解私聊可能使用我的个人记忆与有权限的资料，回答会发送到所选平台，并按现有 Everplain 用量计费。", fontSize = 13.sp)
        }
        val grant = s.grant
        if (grant != null) {
            Text("在机器人私聊发送这条命令", fontSize = 13.sp)
            SelectionContainer { Text("/bind ${grant.code}", fontSize = 16.sp) }
            Text("剩余 ${s.remaining/60} 分 ${s.remaining%60} 秒，只可使用一次。不要转发给他人。", fontSize = 13.sp)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                EpButton(
                    "复制命令",
                    {
                        clipboard.setText(AnnotatedString("/bind ${grant.code}"))
                        c.copied()
                    },
                    enabled = !s.busy && s.remaining > 0,
                )
                target
                    ?.botUrl
                    ?.takeIf {
                        runCatching { Uri.parse(it).scheme in setOf("https", "http") }
                            .getOrDefault(false)
                    }
                    ?.let { url ->
                        EpButton(
                            "打开机器人私聊",
                            { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) },
                            enabled = !s.busy,
                        )
                    }
                EpButton("作废绑定码", c::cancel, enabled = !s.busy)
            }
            if (target?.botUrl == null)
                Text("管理员还没有设置机器人入口，请在平台中打开上述机器人；不要把绑定码发到群里。", fontSize = 13.sp)
            Text(
                "此页会自动确认绑定状态。关闭页面只隐藏命令；需要立即失效时，请点“作废绑定码”。",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else
            EpButton(
                if (s.busy) "正在生成…" else "生成一次性绑定码",
                c::generate,
                primary = true,
                enabled = s.consent && !s.busy && !s.loading,
            )
    } else if (!s.loading && s.error == null)
        Text("聊天平台尚未启用。管理员配置官方机器人后，入口会显示在这里。", fontSize = 14.sp)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("已绑定账号", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        EpButton("刷新状态", c::refresh, enabled = !s.busy)
    }
    if (s.bindings.isEmpty())
        Text("还没有绑定的聊天账号。", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    s.bindings.forEach { binding ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    s.gateways.find { it.gatewayId == binding.gatewayId }?.name
                        ?: binding.gatewayId,
                    fontSize = 14.sp,
                )
                Text("平台账号: ${binding.subjectId}", fontSize = 13.sp)
            }
            EpButton("解除绑定", { confirm = binding }, enabled = !s.busy)
        }
        if (confirm?.bindingId == binding.bindingId) {
            Text("解除后此账号不能继续使用你的 Agent，该平台未使用的绑定码也会作废。已发送的内容不会撤回。", fontSize = 13.sp)
            Row {
                EpButton("取消", { confirm = null }, enabled = !s.busy)
                EpButton("确认解除", { c.revoke(binding.bindingId) }, enabled = !s.busy)
            }
        }
    }
}
