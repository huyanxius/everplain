package app.everplain.android

import android.os.SystemClock
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.layout.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.*
import app.everplain.core.WireJson
import app.everplain.shared.EverplainTokens
import kotlin.math.*
import kotlinx.serialization.json.*

internal data class FlightLaunch(val rect: Rect, val text: String, val at: Long)

internal data class BubbleFlight(val launch: FlightLaunch, val target: Rect)

internal class SendFlightState {
    var editorBounds: Rect? = null
    private var launch: FlightLaunch? = null
    var flight by mutableStateOf<BubbleFlight?>(null)

    fun mark(text: String) {
        launch = editorBounds?.let { FlightLaunch(it, text.trim(), SystemClock.uptimeMillis()) }
    }

    fun consume(text: String, target: Rect, motion: Boolean) {
        val mark = launch ?: return
        launch = null
        if (motion && text.trim() == mark.text && SystemClock.uptimeMillis() - mark.at <= 2000)
            flight = BubbleFlight(mark, target)
    }

    fun cancel() {
        launch = null
        flight = null
    }
}

internal val LocalSendFlight = staticCompositionLocalOf<SendFlightState?> { null }

/** Decorative-only overlay. Real question remains in layout and accessibility throughout. */
@Composable
internal fun SendFlightOverlay(state: SendFlightState, origin: Offset) {
    val flight = state.flight ?: return
    val enabled = rememberMotionEnabled()
    val context = LocalContext.current
    val parameters = remember {
        context.assets.open("motion-parameters.json").bufferedReader().use {
            WireJson.parseToJsonElement(it.readText()).jsonObject.getValue("sendFlight").jsonObject
        }
    }
    val samples = remember {
        parameters.getValue("cssLinearSamples").jsonArray.map { it.jsonPrimitive.float }
    }
    val progress = remember(flight) { Animatable(0f) }
    LaunchedEffect(flight, enabled) {
        if (!enabled) {
            state.cancel()
            return@LaunchedEffect
        }
        progress.animateTo(1f, tween(940, easing = LinearEasing))
        if (state.flight == flight) state.cancel()
    }
    fun sample(values: List<Float>, at: Float): Float {
        val index = (at * (values.size - 1)).coerceIn(0f, values.lastIndex.toFloat())
        val i = floor(index).toInt()
        return values[i] + (values[min(values.lastIndex, i + 1)] - values[i]) * (index - i)
    }
    val t = progress.value
    val sx = remember {
        parameters.getValue("stretchFrames").jsonArray.map {
            it.jsonObject.getValue("scaleX").jsonPrimitive.float
        }
    }
    val sy = remember {
        parameters.getValue("stretchFrames").jsonArray.map {
            it.jsonObject.getValue("scaleY").jsonPrimitive.float
        }
    }
    val density = LocalDensity.current
    val paddingX = with(density) { 20.dp.toPx() }
    val paddingY = with(density) { 12.dp.toPx() }
    val dx = flight.launch.rect.left - (flight.target.left + paddingX)
    val dy = flight.launch.rect.top - (flight.target.top + paddingY)
    val vertical = CubicBezierEasing(.22f, 1f, .36f, 1f).transform((t / .62f).coerceAtMost(1f))
    val background = CubicBezierEasing(.4f, 0f, .2f, 1f).transform((t / .4f).coerceAtMost(1f))
    Box(
        Modifier.offset {
                IntOffset(
                    (flight.target.left - origin.x).roundToInt(),
                    (flight.target.top - origin.y).roundToInt(),
                )
            }
            .requiredSize(
                with(density) { flight.target.width.toDp() },
                with(density) { flight.target.height.toDp() },
            )
            .graphicsLayer {
                translationX = dx * (1 - sample(samples, t))
                translationY = dy * (1 - vertical)
                scaleX = sample(sx, t)
                scaleY = sample(sy, t)
            }
            .background(
                MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = background),
                RoundedCornerShape(EverplainTokens.radiusField.dp),
            )
            .clearAndSetSemantics {}
    ) {
        Text(
            flight.launch.text,
            Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}
