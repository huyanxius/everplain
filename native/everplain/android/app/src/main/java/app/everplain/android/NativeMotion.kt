package app.everplain.android

import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.toColorInt
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.everplain.core.*
import app.everplain.shared.EverplainTokens
import kotlin.math.*
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*

@Composable
internal fun rememberMotionEnabled(): Boolean {
    val context = LocalContext.current
    fun read() =
        Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) > 0f
    var enabled by remember { mutableStateOf(read()) }
    DisposableEffect(context) {
        val observer =
            object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean) {
                    enabled = read()
                }
            }
        context.contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            observer,
        )
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    return enabled
}

/**
 * Stops requesting animation frames while backgrounded; reduced motion renders source frame zero.
 */
@Composable
internal fun motionSeconds(enabled: Boolean): Float {
    val owner = LocalLifecycleOwner.current
    var elapsed by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(enabled, owner) {
        if (!enabled) {
            elapsed = 0f
            return@LaunchedEffect
        }
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            var last = 0L
            while (true) withFrameNanos { now ->
                if (last != 0L) elapsed += (now - last) / 1e9f
                last = now
            }
        }
    }
    return elapsed
}

data class PacedText(val visible: String, val revealedAt: List<Double>)

@Composable
internal fun rememberPacedText(answer: String, streaming: Boolean): PacedText {
    val reduced = !rememberMotionEnabled()
    val pacer = remember { StreamPacer(answer, streaming, reduced) }
    var view by remember { mutableStateOf(PacedText(pacer.visible, pacer.revealedAt)) }
    val wake = remember {
        kotlinx.coroutines.channels.Channel<Unit>(kotlinx.coroutines.channels.Channel.CONFLATED)
    }
    LaunchedEffect(answer, streaming, reduced) {
        pacer.update(answer, streaming, reduced)
        view = PacedText(pacer.visible, pacer.revealedAt)
        wake.trySend(Unit)
    }
    LaunchedEffect(wake) {
        for (signal in wake) {
            while (pacer.needsTick) {
                delay(48)
                if (pacer.tick(SystemClock.uptimeMillis().toDouble()))
                    view = PacedText(pacer.visible, pacer.revealedAt)
            }
        }
    }
    return if (reduced) PacedText(answer, emptyList()) else view
}

@Composable
internal fun ThinkingStatus(active: Boolean, text: String) {
    val motion = rememberMotionEnabled()
    var keepClock by remember { mutableStateOf(active) }
    LaunchedEffect(active, motion) {
        if (active && motion) keepClock = true
        else {
            if (motion) delay(420)
            keepClock = false
        }
    }
    val now = motionSeconds(keepClock && motion) * 1000
    var rendered by remember { mutableStateOf(text) }
    var exiting by remember { mutableStateOf(false) }
    var phaseStart by remember { mutableFloatStateOf(0f) }
    val latestNow by rememberUpdatedState(now)
    LaunchedEffect(text, active, motion) {
        if (!active) return@LaunchedEffect
        if (!motion) {
            rendered = text
            exiting = false
            return@LaunchedEffect
        }
        if (rendered != text) {
            exiting = true
            phaseStart = latestNow
            delay(460)
            rendered = text
            exiting = false
            phaseStart = latestNow
        }
    }
    AnimatedVisibility(
        active,
        enter = EnterTransition.None,
        exit =
            shrinkVertically(
                tween(if (motion) 420 else 0, easing = CubicBezierEasing(.16f, 1f, .3f, 1f))
            ) + fadeOut(tween(if (motion) 240 else 0)),
    ) {
        val chars =
            remember(rendered) {
                rendered.codePoints().toArray().map { String(Character.toChars(it)) }
            }
        val elapsed = now - phaseStart
        val rest = !motion || (!exiting && elapsed >= 100 + min(chars.size * 24, 340) + 520)
        val colors = MaterialTheme.colorScheme
        val shine = EverplainTokens.colorShine(colors.background.luminance() < .5f).compose()
        val density = LocalDensity.current
        var width by remember { mutableFloatStateOf(160f) }
        Box(
            Modifier.padding(top = 4.dp, bottom = 16.dp)
                .onSizeChanged { width = it.width.toFloat() }
                .semantics {
                    contentDescription = rendered
                    liveRegion = LiveRegionMode.Polite
                }
        ) {
            if (rest) {
                val phase = ((elapsed / 1000f) % 1.333f) / 1.333f
                val start = width * (-.5f + 1.75f * phase)
                Text(
                    rendered,
                    Modifier.clearAndSetSemantics {},
                    fontSize = 16.sp,
                    lineHeight = 28.sp,
                    fontWeight = FontWeight.Medium,
                    style =
                        LocalTextStyle.current.copy(
                            letterSpacing = (-.16).sp,
                            brush =
                                if (!motion) SolidColor(colors.onSurfaceVariant)
                                else
                                    Brush.linearGradient(
                                        0f to colors.onSurfaceVariant,
                                        .4f to shine,
                                        .6f to shine,
                                        1f to colors.onSurfaceVariant,
                                        start = Offset(start, 0f),
                                        end = Offset(start + width * .5f, 0f),
                                    ),
                        ),
                )
            } else {
                FlowRow(Modifier.clearAndSetSemantics {}) {
                    chars.forEachIndexed { i, char ->
                        val age =
                            if (exiting) elapsed - min((chars.lastIndex - i) * 10, 140)
                            else elapsed - 100 - min(i * 24, 340)
                        val p = (age / (if (exiting) 300f else 520f)).coerceIn(0f, 1f)
                        val curve =
                            if (exiting) CubicBezierEasing(.55f, 0f, 1f, .45f)
                            else CubicBezierEasing(.16f, 1f, .3f, 1f)
                        val eased = curve.transform(p)
                        val hidden = if (exiting) eased else 1 - eased
                        Text(
                            char,
                            Modifier.graphicsLayer {
                                    alpha = 1 - hidden
                                    translationY =
                                        with(density) { 16.sp.toPx() } *
                                            .42f *
                                            hidden *
                                            (if (exiting) -1 else 1)
                                }
                                .blur((4 * hidden).dp),
                            color = colors.onSurfaceVariant,
                            fontSize = 16.sp,
                            lineHeight = 28.sp,
                            fontWeight = FontWeight.Medium,
                            letterSpacing = (-.16).sp,
                        )
                    }
                }
            }
        }
    }
}

/** Native Canvas port of exact AgentLiquid.tsx using shared 120-radius contours. */
@Composable
internal fun AgentLiquid(
    lead: String? = null,
    color: String? = null,
    size: Int = 76,
    label: String = "正在加载",
) {
    val context = LocalContext.current
    val enabled = rememberMotionEnabled()
    val t = motionSeconds(enabled)
    val presets = remember {
        context.assets
            .open("avatars.json")
            .bufferedReader()
            .use { WireJson.parseToJsonElement(it.readText()).jsonObject }
            .getValue("presets")
            .jsonArray
            .associate { it.jsonObject.getValue("id").jsonPrimitive.content to it.jsonObject }
    }
    val outlines = remember {
        context.assets.open("liquid-outlines.json").bufferedReader().use {
            WireJson.parseToJsonElement(it.readText()).jsonObject
        }
    }
    val order =
        remember(lead) {
            val ids = outlines.getValue("order").jsonArray.map { it.jsonPrimitive.content }
            val first = lead?.takeIf { it in presets } ?: "cheng"
            listOf(first) + ids.filter { it != first }
        }
    val radii = remember {
        outlines.getValue("radiiById").jsonObject.mapValues { (_, v) ->
            v.jsonArray.map { it.jsonPrimitive.float }
        }
    }
    Canvas(Modifier.size(size.dp).semantics { contentDescription = label }) {
        val hold = .6f
        val flow = 2f / 3
        val period = hold + flow
        val k = floor(t / period).toInt()
        val local = t - k * period
        val ai = order[k % order.size]
        val bi = order[(k + 1) % order.size]
        val a = presets.getValue(ai)
        val b = presets.getValue(bi)
        val p = if (local > hold) sourceSpring(((local - hold) * 1.5).toDouble()).toFloat() else 0f
        val w = p.coerceIn(0f, 1f)
        val amp =
            .5f +
                if (local > hold) 2.6f * sin(PI.toFloat() * min(1f, (local - hold) / flow)) else 0f
        val tw = t * 1.5f
        val points =
            List(120) { j ->
                val ang = -PI.toFloat() / 2 + j * 2 * PI.toFloat() / 120
                val ar = radii.getValue(ai)[j]
                val br = radii.getValue(bi)[j]
                val r =
                    ar +
                        (br - ar) * p +
                        amp * (.6f * sin(3 * ang + tw * 2.1f) + .4f * sin(5 * ang - tw * 1.7f))
                Offset(60 + cos(ang) * r, 62 + sin(ang) * r)
            }
        val body =
            Path().apply {
                moveTo(points[0].x, points[0].y)
                points.indices.forEach { i ->
                    val prev = points[(i + 119) % 120]
                    val start = points[i]
                    val end = points[(i + 1) % 120]
                    val next = points[(i + 2) % 120]
                    val c1 = start + (end - prev) / 6f
                    val c2 = end - (next - start) / 6f
                    cubicTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
                }
                close()
            }
        fun presetColor(id: String, obj: JsonObject) =
            Color(
                (if (lead == id && color != null) color
                    else obj.getValue("color").jsonPrimitive.content)
                    .toColorInt()
            )
        val bodyColor =
            lerp(
                    presetColor(ai, a).convert(ColorSpaces.Oklab),
                    presetColor(bi, b).convert(ColorSpaces.Oklab),
                    w,
                )
                .convert(ColorSpaces.Srgb)
        val inner =
            lerp(
                    bodyColor.convert(ColorSpaces.Oklab),
                    Color(0xff1b1a24).convert(ColorSpaces.Oklab),
                    .22f,
                )
                .convert(ColorSpaces.Srgb)
        val ink = Color(0xff16141f).copy(alpha = .86f)
        fun number(o: JsonObject, key: String) = o[key]?.jsonPrimitive?.floatOrNull ?: 0f
        val lookA = a.getValue("look").jsonObject
        val lookB = b.getValue("look").jsonObject
        val x = number(lookA, "x") + (number(lookB, "x") - number(lookA, "x")) * p
        val y = number(lookA, "y") + (number(lookB, "y") - number(lookA, "y")) * p
        // Shared idle CSS look/breathe/blink keyframe timing; morph continues independently.
        fun keyframe(phase: Float, keys: List<Pair<Float, Float>>, easing: Easing): Float {
            val end = keys.indexOfFirst { it.first >= phase }.coerceAtLeast(1)
            val lo = keys[end - 1]
            val hi = keys[end]
            return lo.second +
                (hi.second - lo.second) *
                    easing.transform(((phase - lo.first) / (hi.first - lo.first)).coerceIn(0f, 1f))
        }
        val ease = CubicBezierEasing(.5f, 0f, .3f, 1f)
        val phase = if (enabled) t % 8 / 8 else 0f
        val turn =
            keyframe(
                phase,
                listOf(
                    0f to 0f,
                    .22f to 0f,
                    .30f to -1f,
                    .48f to -1f,
                    .56f to -.45f,
                    .62f to -.45f,
                    .70f to 0f,
                    1f to 0f,
                ),
                ease,
            )
        val nod =
            keyframe(
                phase,
                listOf(
                    0f to 0f,
                    .22f to 0f,
                    .30f to .25f,
                    .48f to .25f,
                    .56f to -.6f,
                    .62f to -.6f,
                    .70f to 0f,
                    1f to 0f,
                ),
                ease,
            )
        val breathe =
            if (enabled)
                keyframe(
                    t % 3.4f / 3.4f,
                    listOf(0f to 0f, .5f to 1f, 1f to 0f),
                    CubicBezierEasing(.42f, 0f, .58f, 1f),
                )
            else 0f
        val blink =
            if (enabled)
                keyframe(
                    t % 4.6f / 4.6f,
                    listOf(0f to 1f, .91f to 1f, .935f to .08f, .96f to 1f, 1f to 1f),
                    CubicBezierEasing(.25f, .1f, .25f, 1f),
                )
            else 1f
        scale(this.size.width / 120f, this.size.height / 120f, Offset.Zero) {
            translate(0f, -1.5f * breathe) {
                scale(1f - .0175f * breathe, 1f + .0175f * breathe, Offset(60f, 90f)) {
                    translate(turn * 2.5f, nod * -1.5f) {
                        listOf(a to (1 - w), b to w).forEach { (obj, opacity) ->
                            if (opacity > 0)
                                scale(
                                    .55f + .45f * opacity,
                                    .55f + .45f * opacity,
                                    Offset(60f, 62f),
                                ) {
                                    obj["behind"]?.jsonArray?.forEach { raw ->
                                        val e = raw.jsonObject
                                        val fill =
                                            when (e["fill"]?.jsonPrimitive?.content) {
                                                "inner" -> inner
                                                "ink" -> ink
                                                else -> bodyColor
                                            }.copy(
                                                alpha =
                                                    opacity *
                                                        (e["opacity"]?.jsonPrimitive?.floatOrNull
                                                            ?: 1f)
                                            )
                                        when (e["type"]?.jsonPrimitive?.content) {
                                            "circle" ->
                                                drawCircle(
                                                    fill,
                                                    number(e, "r"),
                                                    Offset(number(e, "cx"), number(e, "cy")),
                                                )
                                            "path" ->
                                                drawPath(
                                                    PathParser()
                                                        .parsePathString(
                                                            e.getValue("path").jsonPrimitive.content
                                                        )
                                                        .toPath(),
                                                    fill,
                                                    style =
                                                        if (
                                                            e["fill"]?.jsonPrimitive?.content ==
                                                                "none"
                                                        )
                                                            Stroke(
                                                                number(e, "strokeWidth"),
                                                                cap = StrokeCap.Round,
                                                            )
                                                        else Fill,
                                                )
                                            "line" ->
                                                drawLine(
                                                    bodyColor.copy(alpha = opacity),
                                                    Offset(number(e, "x1"), number(e, "y1")),
                                                    Offset(number(e, "x2"), number(e, "y2")),
                                                    number(e, "strokeWidth"),
                                                    StrokeCap.Round,
                                                )
                                        }
                                    }
                                }
                        }
                    }
                    drawPath(body, bodyColor)
                    translate(x + turn * 20f, y + nod * 8f) {
                        rotate(-14 - turn * 28, Offset(0f, 2.2f)) {
                            listOf(-6.6f, 6.6f).forEach { dx ->
                                scale(1f, blink, Offset(dx, 0f)) {
                                    drawRoundRect(
                                        ink,
                                        Offset(dx - 3.6f, -8f),
                                        Size(7.2f, 16f),
                                        CornerRadius(3.6f),
                                    )
                                }
                            }
                            val nose =
                                ((if (a["nose"]?.jsonPrimitive?.booleanOrNull == true) 1 - w
                                else 0f) +
                                    (if (b["nose"]?.jsonPrimitive?.booleanOrNull == true) w
                                    else 0f)) * .86f
                            drawOval(
                                Color(0xff16141f).copy(alpha = nose),
                                Offset(-2.6f, 8.6f),
                                Size(5.2f, 3.8f),
                            )
                        }
                    }
                }
            }
        }
    }
}
