package app.everplain.android

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

/**
 * One stable editor slot across responsive layouts, so composing text keeps its input connection.
 */
@Composable
internal fun ComposerGrid(
    research: Boolean,
    narrow: Boolean,
    multiline: Boolean,
    content: @Composable () -> Unit,
) {
    Layout(content = content, modifier = Modifier) { children, constraints ->
        require(children.size == 4)
        val width = constraints.maxWidth
        val gap = 8.dp.roundToPx()
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val tools = children[0].measure(loose)
        val send = children[3].measure(loose)
        val modelMax =
            (width -
                    tools.width -
                    send.width -
                    gap * 3 -
                    if (narrow || research) 0 else 80.dp.roundToPx())
                .coerceAtLeast(0)
        val model = children[2].measure(loose.copy(maxWidth = modelMax))
        val editorWidth =
            when {
                research -> width
                narrow -> width - tools.width - gap
                else -> width - tools.width - model.width - send.width - gap * 3
            }.coerceAtLeast(0)
        val editor =
            children[1].measure(
                Constraints(
                    minWidth = editorWidth,
                    maxWidth = editorWidth,
                    maxHeight = constraints.maxHeight,
                )
            )
        val twoRows = research || narrow
        val firstHeight = if (research) editor.height else maxOf(tools.height, editor.height)
        val rowGap = if (research) 12.dp.roundToPx() else gap
        val secondHeight = maxOf(model.height, send.height, if (research) tools.height else 0)
        val height =
            if (twoRows) firstHeight + rowGap + secondHeight
            else maxOf(firstHeight, model.height, send.height)
        layout(width, height) {
            fun y(placeableHeight: Int, rowHeight: Int) =
                if (multiline) rowHeight - placeableHeight else (rowHeight - placeableHeight) / 2
            editor.placeRelative(
                if (research) 0 else tools.width + gap,
                if (research) 0 else y(editor.height, if (twoRows) firstHeight else height),
            )
            tools.placeRelative(
                0,
                if (research) firstHeight + rowGap + (secondHeight - tools.height) / 2
                else y(tools.height, if (twoRows) firstHeight else height),
            )
            model.placeRelative(
                width - send.width - gap - model.width,
                if (twoRows) firstHeight + rowGap + (secondHeight - model.height) / 2
                else y(model.height, height),
            )
            send.placeRelative(
                width - send.width,
                if (twoRows) firstHeight + rowGap + (secondHeight - send.height) / 2
                else y(send.height, height),
            )
        }
    }
}
