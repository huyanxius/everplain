package app.everplain.android

import android.text.SpannableString
import android.text.Spanned
import android.util.TypedValue
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.widget.TextView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.*
import kotlin.math.max
import kotlin.math.min

/** Immutable source text stays plain so selection anchors never point into stripped Markdown. */
@Composable
internal fun NativeMaterialPassage(
    segment: ResearchMaterialSegmentResponse,
    select: (MaterialSelection) -> Unit,
) {
    val currentSegment by rememberUpdatedState(segment)
    val currentSelect by rememberUpdatedState(select)
    val ink = MaterialTheme.colorScheme.onSurface.toArgb()
    AndroidView(
        Modifier.fillMaxWidth(),
        factory = { context ->
            TextView(context).apply {
                setTextIsSelectable(true)
                includeFontPadding = false
                setPadding(0, 0, 0, 0)
                customSelectionActionModeCallback =
                    object : ActionMode.Callback {
                        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
                            menu
                                .add(Menu.NONE, 7351, Menu.NONE, "标记片段")
                                .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
                            return true
                        }

                        override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
                            menu.findItem(7351)?.isEnabled =
                                selectionStart >= 0 && selectionEnd != selectionStart
                            return false
                        }

                        override fun onActionItemClicked(
                            mode: ActionMode,
                            item: MenuItem,
                        ): Boolean {
                            if (item.itemId != 7351) return false
                            materialSelection(
                                    currentSegment,
                                    min(selectionStart, selectionEnd),
                                    max(selectionStart, selectionEnd),
                                )
                                ?.let(currentSelect)
                            mode.finish()
                            return true
                        }

                        override fun onDestroyActionMode(mode: ActionMode) = Unit
                    }
            }
        },
        update = { view ->
            view.typeface =
                if (segment.kind == "heading")
                    android.graphics.Typeface.create(
                        android.graphics.Typeface.SERIF,
                        android.graphics.Typeface.BOLD,
                    )
                else android.graphics.Typeface.SERIF
            view.setTextColor(ink)
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, EverplainTokens.textReading)
            // Keep the same TextView and selection when unrelated model or annotation state
            // changes.
            if (view.text.toString() != segment.text) {
                val styled = SpannableString(segment.text)
                if (styled.isNotEmpty())
                    styled.setSpan(
                        SourceReadingLineHeight(view.resources.displayMetrics.scaledDensity),
                        0,
                        styled.length,
                        Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                    )
                view.text = styled
            }
        },
    )
}

@Composable
internal fun MaterialAnnotationDrawer(c: MaterialAnnotationController) {
    val s by c.state.collectAsStateWithLifecycle()
    val d = s.draft ?: return
    if (!s.open) return
    LibrarySheet("片段标记", c::hide) {
        Text(d.selection.quote, style = MaterialTheme.typography.bodyLarge)
        val location = d.selection.segment.locator
        Text(
            listOfNotNull(
                    location.page?.let { "第 $it 页" },
                    location.paragraph?.let { "第 $it 段" },
                    location.sectionPath.takeIf { it.isNotEmpty() }?.joinToString(" / "),
                )
                .joinToString(" · "),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
        )
        s.error?.let { LibraryNotice(it, true) }
        if (s.unknown) EpButton("恢复原标记请求", c::retry, enabled = !s.busy)
        SettingsChoice(
            "标记类型",
            d.kind,
            listOf("descriptive" to "描述性材料", "researcher_reflection" to "研究者反思"),
            !s.busy,
        ) { kind ->
            c.edit { it.copy(kind = kind) }
        }
        EpField(
            "材料描述",
            d.note,
            { value -> c.edit { it.copy(note = value) } },
            multiline = true,
            minLines = 3,
            monospace = false,
            placeholder = "这段原文在说什么",
        )
        Text(
            if (d.kind == "researcher_reflection") "研究者反思 · 必填" else "研究者反思 · 可选",
            fontSize = 13.sp,
        )
        EpField(
            "研究者反思",
            d.reflection,
            { value -> c.edit { it.copy(reflection = value) } },
            multiline = true,
            minLines = 3,
            monospace = false,
            showLabel = false,
            placeholder = "我从这里读出了什么，又该警惕什么",
        )
        Text("补充背景 · 可选", fontSize = 13.sp)
        EpField(
            "案例",
            d.caseLabel,
            { value -> c.edit { it.copy(caseLabel = value) } },
            placeholder = "如：家庭 A",
        )
        EpField(
            "时间",
            d.observedAt,
            { value -> c.edit { it.copy(observedAt = value) } },
            placeholder = "如：迁移后",
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EpButton("取消", c::hide, secondary = true)
            EpButton(
                if (s.busy) "正在保存" else "保存片段标记",
                c::save,
                primary = true,
                enabled = d.ready && !s.busy && !s.unknown,
            )
        }
    }
}
