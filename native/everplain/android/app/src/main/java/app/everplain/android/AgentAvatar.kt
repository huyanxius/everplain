package app.everplain.android

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.core.graphics.toColorInt
import app.everplain.core.WireJson
import kotlinx.serialization.json.*

val avatarNames =
    listOf(
        "cheng" to "澄",
        "nian" to "念",
        "qi" to "栖",
        "shi" to "拾",
        "heng" to "恒",
        "ruo" to "若",
        "you" to "悠",
    )

private fun JsonObject.number(key: String) = this[key]?.jsonPrimitive?.floatOrNull ?: 0f

private fun nativePath(data: String) = PathParser().parsePathString(data).toPath()

private fun colorValue(value: String?, fallback: Color): Color =
    runCatching { value?.let { Color(it.toColorInt()) } ?: fallback }.getOrDefault(fallback)

/** Exact canonical Web geometry, rendered by native Compose Canvas. */
@Composable
fun AgentAvatar(
    id: String,
    color: String?,
    label: String,
    size: Int,
    state: String = "idle",
    playing: Boolean = true,
    offsetSeconds: Float = 0f,
    decorative: Boolean = false,
) {
    val context = LocalContext.current
    val motion = rememberMotionEnabled()
    val animated = playing && motion
    val elapsed = motionSeconds(animated)
    val started = animated && elapsed >= offsetSeconds
    val duration =
        when (state) {
            "greet" -> 2.2f
            "work" -> 1.2f
            "think" -> 5f
            else -> 8f
        }
    val phase = if (started) (elapsed - offsetSeconds) % duration / duration else 0f
    val blink = if (started) (elapsed - offsetSeconds) % 4.6f / 4.6f else 0f
    val breatheDuration =
        when (state) {
            "work" -> .4f
            "think" -> 4.4f
            else -> 3.4f
        }
    val breatheTime =
        if (state in setOf("work", "think")) elapsed
        else (elapsed - offsetSeconds).coerceAtLeast(0f)
    val breathePhase = breatheTime % breatheDuration / breatheDuration
    val ease =
        when (state) {
            "greet" -> CubicBezierEasing(.3f, .7f, .3f, 1f)
            "work" -> CubicBezierEasing(.4f, 0f, .6f, 1f)
            "think" -> CubicBezierEasing(.42f, 0f, .58f, 1f)
            else -> CubicBezierEasing(.5f, 0f, .3f, 1f)
        }
    fun sample(at: Float, points: List<Pair<Float, Float>>): Float {
        val index = points.indexOfLast { it.first <= at }.coerceIn(0, points.size - 2)
        val (t0, v0) = points[index]
        val (t1, v1) = points[index + 1]
        val t = ((at - t0) / (t1 - t0)).coerceIn(0f, 1f)
        return v0 + (v1 - v0) * ease.transform(t)
    }
    val turn =
        if (!started) 0f
        else if (state == "greet") -.5f
        else if (state == "work")
            sample(phase, listOf(0f to -1f, .78f to -.05f, .86f to 0f, 1f to -1f))
        else if (state == "think") sample(phase, listOf(0f to -.2f, .5f to -.75f, 1f to -.2f))
        else
            sample(
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
            )
    val nod =
        if (state == "work") 1f
        else if (!started || state == "greet") 0f
        else if (state == "think") sample(phase, listOf(0f to -1f, .5f to -.75f, 1f to -1f))
        else
            sample(
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
            )
    val lift =
        if (!animated || (state == "greet" && !started)) 0f
        else if (state == "greet")
            sample(phase, listOf(0f to 0f, .08f to 0f, .22f to 12f, .36f to 0f, 1f to 0f))
        else {
            val triangle = if (breathePhase <= .5f) breathePhase * 2 else (1 - breathePhase) * 2
            CubicBezierEasing(.42f, 0f, .58f, 1f).transform(triangle) *
                if (state == "work") 1.8f else 1.5f
        }
    val squash =
        if (!animated || (state == "greet" && !started)) 0f
        else if (state == "greet")
            sample(
                phase,
                listOf(0f to 0f, .08f to 1f, .22f to -.8f, .36f to .8f, .46f to 0f, 1f to 0f),
            )
        else if (state == "work") 0f else -lift / 6f
    val tilt =
        if (!started) 0f
        else if (state == "think") sample(phase, listOf(0f to -5f, .5f to 3f, 1f to -5f))
        else if (state != "greet") 0f
        else
            sample(
                phase,
                listOf(0f to 0f, .08f to 0f, .22f to -6f, .36f to 5f, .46f to 0f, 1f to 0f),
            )
    val baseLid = if (state == "work") .62f else if (state == "think") .8f else 1f
    val lid =
        if (!started) baseLid
        else {
            val keys =
                listOf(
                    0f to baseLid,
                    .91f to baseLid,
                    .935f to .08f,
                    .96f to baseLid,
                    1f to baseLid,
                )
            val i = keys.indexOfLast { it.first <= blink }.coerceIn(0, keys.size - 2)
            val from = keys[i]
            val to = keys[i + 1]
            from.second +
                (to.second - from.second) *
                    CubicBezierEasing(.25f, .1f, .25f, 1f)
                        .transform((blink - from.first) / (to.first - from.first))
        }
    val document = remember {
        context.assets.open("avatars.json").bufferedReader().use {
            WireJson.parseToJsonElement(it.readText()).jsonObject
        }
    }
    val preset =
        remember(id) {
            document
                .getValue("presets")
                .jsonArray
                .firstOrNull { it.jsonObject["id"]?.jsonPrimitive?.content == id }
                ?.jsonObject
        }
    val body = remember(preset) { preset?.get("path")?.jsonPrimitive?.content?.let(::nativePath) }
    Canvas(
        Modifier.size(size.dp)
            .then(
                if (decorative) Modifier.clearAndSetSemantics {}
                else Modifier.semantics { contentDescription = label }
            )
    ) {
        if (preset == null || body == null) return@Canvas
        val bodyColor =
            colorValue(color, colorValue(preset["color"]?.jsonPrimitive?.content, Color.Gray))
        val ink = Color(0xff16141f).copy(alpha = .86f)
        // Oklab-mixed inner color is provided for canonical colors; custom colors use a quiet tint.
        val inner =
            lerp(
                    bodyColor.convert(ColorSpaces.Oklab),
                    Color(0xff1b1a24).convert(ColorSpaces.Oklab),
                    .22f,
                )
                .convert(ColorSpaces.Srgb)
        scale(this.size.width / 120f, this.size.height / 120f, pivot = Offset.Zero) {
            translate(0f, -lift) {
                withTransform({
                    rotate(tilt, Offset(60f, 90f))
                    val skew = kotlin.math.tan(turn * 2.5f * kotlin.math.PI.toFloat() / 180f)
                    transform(
                        Matrix().apply {
                            this[1, 0] = skew
                            this[3, 0] = -90f * skew
                        }
                    )
                    scale(1f + squash * .07f, 1f - squash * .07f, Offset(60f, 90f))
                }) {
                    translate(turn * 2.5f, nod * -1.5f) {
                        preset["behind"]?.jsonArray?.forEach { value ->
                            val element = value.jsonObject
                            val fill =
                                when (element["fill"]?.jsonPrimitive?.content) {
                                    "inner" -> inner
                                    "ink" -> ink
                                    else -> bodyColor
                                }.copy(alpha = element["opacity"]?.jsonPrimitive?.floatOrNull ?: 1f)
                            when (element["type"]?.jsonPrimitive?.content) {
                                "circle" ->
                                    drawCircle(
                                        fill,
                                        element.number("r"),
                                        Offset(element.number("cx"), element.number("cy")),
                                    )
                                "path" ->
                                    element["path"]?.jsonPrimitive?.content?.let {
                                        drawPath(
                                            nativePath(it),
                                            fill,
                                            style =
                                                if (
                                                    element["fill"]?.jsonPrimitive?.content ==
                                                        "none"
                                                )
                                                    Stroke(
                                                        element.number("strokeWidth"),
                                                        cap = StrokeCap.Round,
                                                    )
                                                else Fill,
                                        )
                                    }
                                "line" ->
                                    drawLine(
                                        bodyColor,
                                        Offset(element.number("x1"), element.number("y1")),
                                        Offset(element.number("x2"), element.number("y2")),
                                        element.number("strokeWidth"),
                                        StrokeCap.Round,
                                    )
                            }
                        }
                    }
                    drawPath(body, bodyColor)
                    val look = preset.getValue("look").jsonObject
                    translate(look.number("x") + turn * 20f, look.number("y") + nod * 8f) {
                        val gaze = preset["gazeOrigin"]?.jsonObject
                        rotate(
                            -14f - turn * 28f,
                            Offset(gaze?.number("x") ?: 0f, gaze?.number("y") ?: 0f),
                        ) {
                            listOf(-6.6f, 6.6f).forEach { offset ->
                                if (state == "greet")
                                    translate(offset, 0f) {
                                        drawPath(
                                            nativePath("M-4.4 2 Q0 -5.5 4.4 2"),
                                            ink,
                                            style = Stroke(3.6f, cap = StrokeCap.Round),
                                        )
                                    }
                                else
                                    scale(1f, lid, pivot = Offset(offset, 0f)) {
                                        drawRoundRect(
                                            ink,
                                            Offset(offset - 3.6f, -8f),
                                            Size(7.2f, 16f),
                                            CornerRadius(3.6f),
                                        )
                                    }
                            }
                            if (preset["nose"]?.jsonPrimitive?.booleanOrNull == true)
                                drawOval(ink, Offset(-2.6f, 8.6f), Size(5.2f, 3.8f))
                        }
                    }
                }
            }
        }
    }
}
