package app.everplain.android

import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Paint
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import app.everplain.shared.EverplainShadow
import kotlin.math.*

/**
 * Source box-shadow layers, cached in a software raster rather than substituting Material
 * elevation. CSS uses sigma = blur / 2: https://www.w3.org/TR/css-backgrounds-3/#shadow-blur
 * Android radius -> sigma is radius*.57735+.5; the inverse preserves the source blur amount.
 */
@Composable
internal fun Modifier.webShadow(shadows: List<EverplainShadow>, corner: Dp): Modifier {
    val layer =
        remember(shadows, corner) {
            Modifier.drawWithCache {
                val margin =
                    ceil(
                            shadows.maxOfOrNull {
                                (abs(it.x) + abs(it.y) + abs(it.spread) + it.blur * 1.5f) * density
                            } ?: 0f
                        )
                        .toInt() + 2
                val width = ceil(size.width).toInt() + margin * 2
                val height = ceil(size.height).toInt() + margin * 2
                val bitmap =
                    if (width > 0 && height > 0 && width.toLong() * height <= 8_000_000L)
                        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    else null
                bitmap?.let {
                    val canvas = Canvas(it)
                    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
                    val radius = min(corner.toPx(), min(size.width, size.height) / 2)
                    shadows.asReversed().forEach { shadow ->
                        paint.color = shadow.color.compose().toArgb()
                        val sigma = shadow.blur * density / 2
                        paint.maskFilter =
                            if (sigma > .5f)
                                BlurMaskFilter((sigma - .5f) / .57735f, BlurMaskFilter.Blur.NORMAL)
                            else null
                        val spread = shadow.spread * density
                        val x = margin + shadow.x * density
                        val y = margin + shadow.y * density
                        canvas.drawRoundRect(
                            x - spread,
                            y - spread,
                            x + size.width + spread,
                            y + size.height + spread,
                            max(0f, radius + spread),
                            max(0f, radius + spread),
                            paint,
                        )
                    }
                }
                val image = bitmap?.asImageBitmap()
                onDrawBehind {
                    image?.let { drawImage(it, Offset(-margin.toFloat(), -margin.toFloat())) }
                }
            }
        }
    return then(layer)
}
