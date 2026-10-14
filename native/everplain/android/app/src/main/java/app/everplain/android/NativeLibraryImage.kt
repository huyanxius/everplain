package app.everplain.android

import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.drawable.Animatable
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.widget.ImageView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.everplain.shared.EverplainTokens
import java.nio.ByteBuffer
import kotlin.math.*
import kotlinx.coroutines.*

/**
 * Same-origin authenticated image preview; raster work is bounded and performed off the UI thread.
 */
@Composable
internal fun NativeLibraryImage(
    c: LibraryController,
    libraryId: String,
    documentId: String,
    filename: String,
) {
    val state by c.state.collectAsStateWithLifecycle()
    val asset =
        remember(state.imageSources, libraryId, documentId) {
            c.previewAsset(libraryId, documentId)
        }
    val context = LocalContext.current
    var image by remember(asset) { mutableStateOf<Drawable?>(null) }
    LaunchedEffect(c, asset) {
        image = null
        if (asset != null)
            try {
                val data = c.imagePreview(asset)
                image =
                    withContext(Dispatchers.Default) {
                        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        BitmapFactory.decodeByteArray(data.bytes, 0, data.bytes.size, options)
                        require(
                            options.outWidth > 0 &&
                                options.outHeight > 0 &&
                                options.outWidth.toLong() * options.outHeight <= 100_000_000L
                        ) {
                            "图片尺寸不可用"
                        }
                        val scale = min(1.0, 1024.0 / max(options.outWidth, options.outHeight))
                        if (Build.VERSION.SDK_INT >= 28)
                            ImageDecoder.decodeDrawable(
                                ImageDecoder.createSource(ByteBuffer.wrap(data.bytes))
                            ) { decoder, _, _ ->
                                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                                decoder.setTargetSize(
                                    max(1, (options.outWidth * scale).toInt()),
                                    max(1, (options.outHeight * scale).toInt()),
                                )
                            }
                        else {
                            val sample = ceil(1 / scale).toInt().coerceAtLeast(1)
                            val bitmap =
                                BitmapFactory.decodeByteArray(
                                    data.bytes,
                                    0,
                                    data.bytes.size,
                                    BitmapFactory.Options().apply { inSampleSize = sample },
                                ) ?: error("图片无法解码")
                            BitmapDrawable(context.resources, bitmap)
                        }
                    }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                image = null
            }
    }
    val owner = LocalLifecycleOwner.current
    val animated = rememberMotionEnabled()
    DisposableEffect(image, owner, animated) {
        val drawable = image as? Animatable
        fun sync() {
            if (animated && owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
                drawable?.start()
            else drawable?.stop()
        }
        val observer = LifecycleEventObserver { _, _ -> sync() }
        owner.lifecycle.addObserver(observer)
        sync()
        onDispose {
            owner.lifecycle.removeObserver(observer)
            drawable?.stop()
        }
    }
    Box(
        Modifier.fillMaxWidth()
            .aspectRatio(16f / 7f)
            .clip(RoundedCornerShape(EverplainTokens.radiusItem.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerLow),
        contentAlignment = Alignment.Center,
    ) {
        if (image != null)
            AndroidView(
                factory = {
                    ImageView(it).apply {
                        scaleType = ImageView.ScaleType.CENTER_CROP
                        contentDescription = filename
                    }
                },
                modifier = Modifier.fillMaxSize(),
                update = { it.setImageDrawable(image) },
            )
        else
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(EpIcons.Image, null, Modifier.size(28.dp))
                Text(
                    "图片预览暂不可用",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
    }
}
