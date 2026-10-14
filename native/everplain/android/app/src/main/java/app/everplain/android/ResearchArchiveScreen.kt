package app.everplain.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
internal fun ResearchArchiveScreen(c: ResearchArchiveController) {
    val s by c.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val save =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/zip")
        ) { uri ->
            if (uri != null)
                c.export {
                    context.contentResolver.openOutputStream(uri, "wt") ?: error("无法写入所选位置")
                }
        }
    LaunchedEffect(c) { c.load() }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            Modifier.widthIn(max = 760.dp).fillMaxSize(),
            contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 40.dp, bottom = 64.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(EpIcons.BoxArrowDown, null, Modifier.size(28.dp))
                    Text("研究归档", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "把研究过程、证据与成果一起保存。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp,
                    )
                }
            }
            item {
                LibraryCard {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(EpIcons.ShieldCheck, null, Modifier.size(24.dp))
                        Text("完整研究归档", style = MaterialTheme.typography.titleLarge)
                    }
                    Text(
                        "包含原始恢复数据、QDPX、BagIt 校验、文稿、交换损失说明与审计记录。",
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    EpButton(
                        if (s.exporting) "正在归档…" else "导出研究归档",
                        { save.launch("research-project.zip") },
                        primary = true,
                        enabled = !s.exporting,
                    )
                }
            }
            s.error?.let { error -> item { LibraryNotice(error, true, "重试读取审计", c::load) } }
            s.exported?.let { result ->
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(EpIcons.CheckCircle, null, Modifier.size(20.dp))
                        Text(
                            "归档已生成：${result.lossCount} 项交换损失，其中 ${result.blockingLossCount} 项阻断；完整说明已写入归档。",
                            fontSize = 14.sp,
                        )
                    }
                }
            }
            item {
                Text(
                    "交换审计",
                    Modifier.padding(top = 20.dp),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            if (s.loading)
                item {
                    Text(
                        "正在读取审计记录…",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp,
                    )
                }
            else if (s.events.isEmpty())
                item {
                    Text(
                        "还没有项目交换记录。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp,
                    )
                }
            items(s.events, key = { it.eventId }) { event ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier.size(8.dp)
                            .background(MaterialTheme.colorScheme.outline, CircleShape)
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(event.eventType, fontSize = 14.sp)
                        Text(
                            "对象版本 ${event.objectVersion ?: "—"}",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        archiveTime(event.occurredAt),
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun archiveTime(value: String) =
    runCatching {
            DateTimeFormatter.ofPattern("M/d HH:mm")
                .withZone(ZoneId.systemDefault())
                .format(Instant.parse(value))
        }
        .getOrDefault(value)
