package app.everplain.android

import android.graphics.BlurMaskFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.core.graphics.toColorInt
import app.everplain.core.WireJson
import kotlin.math.*
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*

private data class CompanionNode(
    val kind: String,
    val a: Map<String, String>,
    val classes: Set<String>,
    val bounds: RectF,
    val path: android.graphics.Path?,
    val children: List<CompanionNode>,
)

private class CompanionDrawing(data: JsonObject) {
    private val palette =
        data.getValue("palette").jsonObject.mapValues {
            it.value.jsonPrimitive.content.toColorInt()
        }
    private val gradients =
        data.getValue("defs").jsonArray.associate { value ->
            val node = value.jsonObject
            node.getValue("attributes").jsonObject.getValue("id").jsonPrimitive.content to node
        }
    private val root = read(data.getValue("root").jsonObject)
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val clipFace =
        android.graphics.Path().apply {
            addOval(RectF(43f, 75f, 157f, 179f), android.graphics.Path.Direction.CW)
        }

    private fun read(value: JsonObject): CompanionNode {
        val a = value.getValue("attributes").jsonObject.mapValues { it.value.jsonPrimitive.content }
        fun n(key: String, default: Float = 0f) = a[key]?.toFloatOrNull() ?: default
        val kind = value.getValue("type").jsonPrimitive.content
        val box = (value["bounds"] as? JsonArray)?.map { it.jsonPrimitive.float }
        val bounds = box?.let { RectF(it[0], it[1], it[2], it[3]) } ?: RectF()
        val path =
            when (kind) {
                "path" -> PathParser().parsePathString(a.getValue("d")).toPath().asAndroidPath()
                "ellipse",
                "circle" ->
                    android.graphics.Path().apply {
                        addOval(
                            RectF(
                                n("cx") - n("rx", n("r")),
                                n("cy") - n("ry", n("r")),
                                n("cx") + n("rx", n("r")),
                                n("cy") + n("ry", n("r")),
                            ),
                            android.graphics.Path.Direction.CW,
                        )
                    }
                "rect" ->
                    android.graphics.Path().apply {
                        addRoundRect(
                            RectF(n("x"), n("y"), n("x") + n("width"), n("y") + n("height")),
                            n("rx"),
                            n("ry", n("rx")),
                            android.graphics.Path.Direction.CW,
                        )
                    }
                else -> null
            }
        return CompanionNode(
            kind,
            a,
            a["class"].orEmpty().split(' ').toSet(),
            bounds,
            path,
            value.getValue("children").jsonArray.map { read(it.jsonObject) },
        )
    }

    private fun sample(phase: Float, points: List<Pair<Float, Float>>, ease: Easing): Float {
        val i = points.indexOfLast { it.first <= phase }.coerceIn(0, points.size - 2)
        val (a, x) = points[i]
        val (b, y) = points[i + 1]
        return x + (y - x) * ease.transform(((phase - a) / (b - a)).coerceIn(0f, 1f))
    }

    fun draw(
        canvas: android.graphics.Canvas,
        time: Float,
        breatheTime: Float,
        animated: Boolean,
        happy: Boolean,
        happyTime: Float,
        blushAlpha: Float,
        turn: Float,
        nod: Float,
    ) {
        val ease = CubicBezierEasing(.42f, 0f, .58f, 1f)
        fun applyMotion(node: CompanionNode) {
            val c = node.classes
            val b = node.bounds
            if ("cp-layer" in c)
                canvas.translate(
                    turn * (node.a["data-dx"]?.toFloatOrNull() ?: 0f),
                    nod * (node.a["data-dy"]?.toFloatOrNull() ?: 0f),
                )
            if (!animated) return
            fun sway(
                duration: Float,
                delay: Float = 0f,
                wide: Boolean = false,
                ox: Float = .5f,
                oy: Float = 0f,
            ) {
                val angle =
                    sample(
                        ((time + delay) % duration) / duration,
                        listOf(
                            0f to if (wide) -3f else -1.6f,
                            .5f to if (wide) 3.4f else 1.8f,
                            1f to if (wide) -3f else -1.6f,
                        ),
                        ease,
                    )
                canvas.rotate(angle, b.left + b.width() * ox, b.top + b.height() * oy)
            }
            when {
                "cp-bob" in c -> {
                    val x = b.centerX()
                    val y = b.top + b.height() * .95f
                    var ty = 0f
                    var sx = 1f
                    var sy = 1f
                    if (happy && happyTime < .9f) {
                        val phase = happyTime / .9f
                        val e = CubicBezierEasing(.33f, 0f, .2f, 1f)
                        ty =
                            sample(
                                phase,
                                listOf(
                                    0f to 0f,
                                    .18f to 1.5f,
                                    .46f to -6f,
                                    .72f to 0f,
                                    .88f to -.8f,
                                    1f to 0f,
                                ),
                                e,
                            )
                        sx =
                            sample(
                                phase,
                                listOf(
                                    0f to 1f,
                                    .18f to 1.03f,
                                    .46f to .985f,
                                    .72f to 1.012f,
                                    .88f to 1f,
                                    1f to 1f,
                                ),
                                e,
                            )
                        sy =
                            sample(
                                phase,
                                listOf(
                                    0f to 1f,
                                    .18f to .97f,
                                    .46f to 1.02f,
                                    .72f to .988f,
                                    .88f to 1f,
                                    1f to 1f,
                                ),
                                e,
                            )
                    } else if (!happy) {
                        val phase = breatheTime % 3.8f / 3.8f
                        ty = sample(phase, listOf(0f to 0f, .5f to -1.5f, 1f to 0f), ease)
                        sx = sample(phase, listOf(0f to 1f, .5f to 1.006f, 1f to 1f), ease)
                        sy = sx
                    }
                    canvas.translate(0f, ty)
                    canvas.scale(sx, sy, x, y)
                }
                "cp-sway-slow" in c -> sway(6f, oy = .1f)
                "cp-strand--b" in c -> sway(4.8f, 1.2f)
                "cp-strand--c" in c -> sway(5.1f, 2.4f)
                "cp-strand" in c -> sway(4.2f)
                "cp-lock" in c -> sway(5.4f, if ("cp-lock--right" in c) 2.7f else 0f, true)
                "cp-ribbon" in c -> sway(3.8f, .8f, true, .2f)
                "cp-ahoge" in c ->
                    canvas.rotate(
                        sample(
                            time % 2.6f / 2.6f,
                            listOf(0f to -6f, .4f to 9f, .7f to -2f, 1f to -6f),
                            CubicBezierEasing(.3f, 1.6f, .5f, 1f),
                        ),
                        b.left + b.width() * .3f,
                        b.bottom,
                    )
                "cp-eyes" in c ->
                    canvas.scale(
                        1f,
                        sample(
                            time % 5.2f / 5.2f,
                            listOf(0f to 1f, .91f to 1f, .94f to .08f, .97f to 1f, 1f to 1f),
                            CubicBezierEasing(.25f, .1f, .25f, 1f),
                        ),
                        b.centerX(),
                        b.centerY(),
                    )
            }
        }
        fun color(value: String): Int =
            if (value.startsWith("var("))
                palette.getValue(value.removePrefix("var(").removeSuffix(")"))
            else value.toColorInt()
        fun shader(id: String, b: RectF): Shader? {
            val g = gradients[id] ?: return null
            val stops =
                g.getValue("children").jsonArray.map {
                    it.jsonObject.getValue("attributes").jsonObject
                }
            val colors =
                stops.map { color(it.getValue("stop-color").jsonPrimitive.content) }.toIntArray()
            val positions =
                stops
                    .map {
                        it.getValue("offset").jsonPrimitive.content.removeSuffix("%").toFloat() /
                            100
                    }
                    .toFloatArray()
            val shader =
                if (g.getValue("type").jsonPrimitive.content == "radialGradient")
                    RadialGradient(.42f, .4f, .7f, colors, positions, Shader.TileMode.CLAMP)
                else LinearGradient(0f, 0f, 0f, 1f, colors, positions, Shader.TileMode.CLAMP)
            shader.setLocalMatrix(
                Matrix().apply {
                    setScale(b.width(), b.height())
                    postTranslate(b.left, b.top)
                }
            )
            return shader
        }
        fun drawNode(node: CompanionNode, happyPath: Boolean = false) {
            val c = node.classes
            if ("cp-eyes" in c && happy || "cp-happy" in c && !happy) return
            canvas.save()
            node.a["transform"]?.let { value ->
                Regex("(translate|rotate)\\(([^)]+)\\)").findAll(value).forEach { match ->
                    val p =
                        Regex("[-\\d.]+")
                            .findAll(match.groupValues[2])
                            .map { it.value.toFloat() }
                            .toList()
                    if (match.groupValues[1] == "translate")
                        canvas.translate(p[0], p.getOrElse(1) { 0f })
                    else canvas.rotate(p[0])
                }
            }
            applyMotion(node)
            val happyChild = happyPath || "cp-happy" in c
            node.path?.let { path ->
                paint.reset()
                paint.isAntiAlias = true
                paint.strokeCap = Paint.Cap.ROUND
                paint.style = Paint.Style.FILL
                val fill =
                    when {
                        happyChild -> "none"
                        "cp-sleeve--front" in c -> "url(#companion-sleeve-front)"
                        "cp-sleeve" in c -> "url(#companion-sleeve)"
                        "cp-hand" in c -> "url(#companion-hand)"
                        "cp-ribbon-tail" in c -> "var(--cp-ribbon)"
                        "cp-face-shade" in c -> "var(--cp-hand-shade)"
                        "cp-chin-shadow" in c -> "var(--cp-fold)"
                        c.any { it in setOf("cp-fold", "cp-rib", "cp-finger") } -> "none"
                        else ->
                            node.a["fill"]
                                ?: c.firstOrNull { "--$it" in palette }?.let { "var(--$it)" }
                                ?: "#000000"
                    }
                if (fill.startsWith("url("))
                    paint.shader = shader(fill.removePrefix("url(#").removeSuffix(")"), node.bounds)
                else if (fill != "none") paint.color = color(fill)
                if (fill == "none") {
                    paint.style = Paint.Style.STROKE
                    val key =
                        when {
                            happyChild -> "--cp-eye"
                            "cp-fold" in c -> "--cp-fold"
                            "cp-rib" in c -> "--cp-rib"
                            else -> "--cp-finger"
                        }
                    paint.color = palette.getValue(key)
                    paint.strokeWidth =
                        when {
                            happyChild -> 4f
                            "cp-fold" in c -> 1.4f
                            "cp-rib" in c -> 1f
                            else -> 1.2f
                        }
                }
                val alpha =
                    when {
                        "cp-face-shade" in c || "cp-chin-shadow" in c -> .3f
                        "cp-fold" in c -> .45f
                        "cp-blush" in c -> blushAlpha
                        else -> 1f
                    }
                paint.alpha = (alpha * 255).roundToInt()
                // SVG stdDeviation is sigma. Android JNI converts the supplied radius to
                // sigma with radius*.57735+.5; invert it rather than changing the illustration.
                // https://android.googlesource.com/platform/frameworks/base/+/d8580f8b6e3a579a4141167b00871478ed9dbd85/libs/hwui/jni/MaskFilter.cpp
                if ("cp-blush" in c || "cp-face-shade" in c)
                    paint.maskFilter =
                        BlurMaskFilter((.8f - .5f) / .57735f, BlurMaskFilter.Blur.NORMAL)
                if ("cp-chin-shadow" in c)
                    paint.maskFilter =
                        BlurMaskFilter((3f - .5f) / .57735f, BlurMaskFilter.Blur.NORMAL)
                if (node.a.containsKey("clip-path")) canvas.clipPath(clipFace)
                canvas.drawPath(path, paint)
            }
            node.children.forEach { drawNode(it, happyChild) }
            canvas.restore()
        }
        drawNode(root)
    }
}

/** The product's original Xiaoping is separate from the user's seven geometric Agent avatars. */
@Composable
internal fun HomeCompanion(
    active: Boolean,
    modifier: Modifier = Modifier,
    narrow: Boolean = true,
    pointer: CompanionPointer? = null,
) {
    val enabled = rememberMotionEnabled()
    var present by remember { mutableStateOf(active) }
    val entrance = remember { Animatable(if (active) .7f else 1.05f) }
    LaunchedEffect(active, enabled) {
        if (active) {
            present = true
            if (enabled) {
                entrance.snapTo(.7f)
                delay(400)
                entrance.animateTo(0f, tween(900, easing = CubicBezierEasing(.34f, 1.4f, .64f, 1f)))
            } else entrance.snapTo(0f)
        } else {
            if (enabled)
                entrance.animateTo(1.05f, tween(450, easing = CubicBezierEasing(.4f, 0f, .7f, .2f)))
            present = false
        }
    }
    if (!present) return
    val context = LocalContext.current
    val drawing = remember {
        CompanionDrawing(
            context.assets.open("companion.json").bufferedReader().use {
                WireJson.parseToJsonElement(it.readText()).jsonObject
            }
        )
    }
    val time = motionSeconds(enabled)
    var happy by remember { mutableStateOf(false) }
    var happyStart by remember { mutableFloatStateOf(0f) }
    var breatheStart by remember { mutableFloatStateOf(0f) }
    val latestTime by rememberUpdatedState(time)
    val blushAlpha by
        animateFloatAsState(
            if (happy) .95f else .85f,
            tween(300, easing = CubicBezierEasing(.25f, .1f, .25f, 1f)),
            label = "companion-blush",
        )
    LaunchedEffect(happy) {
        if (happy) {
            delay(1600)
            breatheStart = latestTime
            happy = false
        }
    }
    LaunchedEffect(enabled) { if (!enabled) breatheStart = 0f }
    val gaze = remember { CompanionGaze() }
    val width = if (narrow) 93.dp else 150.dp
    Canvas(
        modifier
            .onGloballyPositioned { pointer?.bounds = it.boundsInRoot() }
            .width(width)
            .height(width * 224f / 220f)
            .graphicsLayer { translationY = size.height * entrance.value }
            .clickable(enabled = active) {
                if (!happy) {
                    happyStart = time
                    happy = true
                }
            }
            .semantics { if (active) contentDescription = "Everplain 的小平" else invisibleToUser() }
    ) {
        val canvas = drawContext.canvas.nativeCanvas
        canvas.save()
        canvas.scale(size.width / 220, size.width / 220)
        canvas.translate(0f, 10f)
        gaze.update(time, enabled, pointer)
        drawing.draw(
            canvas,
            time,
            (time - breatheStart).coerceAtLeast(0f),
            enabled,
            happy,
            (time - happyStart).coerceAtLeast(0f),
            blushAlpha,
            round(gaze.turn * 1000) / 1000,
            round(gaze.nod * 1000) / 1000,
        )
        canvas.restore()
    }
}

/** Passive observation: never consumes the pointer or interferes with scrolling/input. */
internal class CompanionPointer {
    var bounds = Rect.Zero
    var viewport = IntSize.Zero
    var origin = Offset.Zero
    var lastMove = -10000L
    var turn = .2f
    var nod = 0f
}

internal fun Modifier.observeCompanionPointer(state: CompanionPointer): Modifier =
    onGloballyPositioned {
            state.origin = it.boundsInRoot().topLeft
            state.viewport = it.size
        }
        .pointerInput(state) {
            awaitPointerEventScope {
                while (true) {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    val point =
                        event.changes.firstOrNull()?.position?.plus(state.origin) ?: continue
                    if (state.viewport.width > 0 && state.viewport.height > 0) {
                        state.turn =
                            ((point.x - state.bounds.center.x) / (state.viewport.width * .45f))
                                .coerceIn(-1f, 1f)
                        state.nod =
                            ((point.y - state.bounds.center.y) / (state.viewport.height * .6f))
                                .coerceIn(-1f, 1f)
                        state.lastMove = SystemClock.uptimeMillis()
                    }
                }
            }
        }

/** Advances once per actual frame without launching another coroutine/recomposition each tick. */
private class CompanionGaze {
    var turn = .2f
    var nod = 0f
    private var lastFrame = -1f

    fun update(time: Float, enabled: Boolean, pointer: CompanionPointer?) {
        if (!enabled) {
            turn = .25f
            nod = 0f
            lastFrame = -1f
            return
        }
        if (lastFrame == time) return
        lastFrame = time
        val following = pointer != null && SystemClock.uptimeMillis() - pointer.lastMove < 4000
        val desired =
            if (following) pointer!!.turn else sin(time / 2.3f) * .7f + sin(time / .9f) * .12f
        val desiredNod = if (following) pointer!!.nod else sin(time / 3.1f) * .35f
        turn += (desired - turn) * .08f
        nod += (desiredNod - nod) * .08f
    }
}
