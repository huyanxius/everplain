@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.everplain.android

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import app.everplain.shared.*

fun EverplainColor.compose() = Color(red, green, blue, alpha)

@Composable
fun EverplainTheme(appearance: String = "system", content: @Composable () -> Unit) {
    val systemDark = isSystemInDarkTheme()
    val dark =
        when (appearance) {
            "light" -> false
            "dark" -> true
            else -> systemDark
        }
    val activity = LocalActivity.current
    SideEffect {
        activity?.let {
            WindowCompat.getInsetsController(it.window, it.window.decorView).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val accent = EverplainTokens.colorAccent(dark).compose()
    val onAccent = EverplainTokens.colorOnAccent(dark).compose()
    val soft = EverplainTokens.colorAccentSoft(dark).compose()
    val ink = EverplainTokens.colorInk(dark).compose()
    val canvas = EverplainTokens.colorCanvas(dark).compose()
    val surface = EverplainTokens.colorSurface(dark).compose()
    val raised = EverplainTokens.colorSurfaceRaised(dark).compose()
    MaterialTheme(
        colorScheme =
            base.copy(
                primary = accent,
                onPrimary = onAccent,
                primaryContainer = soft,
                onPrimaryContainer = ink,
                secondary = accent,
                onSecondary = onAccent,
                secondaryContainer = soft,
                onSecondaryContainer = ink,
                tertiary = accent,
                onTertiary = onAccent,
                tertiaryContainer = soft,
                onTertiaryContainer = ink,
                surface = canvas,
                background = canvas,
                surfaceVariant = surface,
                surfaceContainerLowest = canvas,
                surfaceContainerLow = EverplainTokens.colorSurfaceMuted(dark).compose(),
                surfaceContainer = surface,
                surfaceContainerHigh = raised,
                surfaceContainerHighest = EverplainTokens.colorSurfaceStrong(dark).compose(),
                surfaceBright = raised,
                surfaceDim = canvas,
                surfaceTint = Color.Transparent,
                onSurface = ink,
                onBackground = ink,
                onSurfaceVariant = EverplainTokens.colorMuted(dark).compose(),
                outline = EverplainTokens.colorRule(dark).compose(),
                outlineVariant = EverplainTokens.colorRule(dark).compose(),
                error = EverplainTokens.colorDanger(dark).compose(),
                onError = onAccent,
                errorContainer = EverplainTokens.colorDangerSoft(dark).compose(),
                onErrorContainer = EverplainTokens.colorDanger(dark).compose(),
                inverseSurface = EverplainTokens.colorSurface(!dark).compose(),
                inverseOnSurface = EverplainTokens.colorInk(!dark).compose(),
                inversePrimary = EverplainTokens.colorAccent(!dark).compose(),
                scrim = EverplainTokens.colorOverlay(dark).compose(),
            ),
        typography =
            Typography(
                headlineLarge =
                    TextStyle(
                        fontFamily = FontFamily.Serif,
                        fontSize = EverplainTokens.textDisplay.sp,
                        lineHeight =
                            (EverplainTokens.textDisplay * EverplainTokens.textDisplayLineHeight)
                                .sp,
                        fontWeight = FontWeight.Medium,
                    ),
                headlineSmall =
                    TextStyle(
                        fontFamily = FontFamily.Serif,
                        fontSize = EverplainTokens.textSection.sp,
                        lineHeight =
                            (EverplainTokens.textSection * EverplainTokens.textSectionLineHeight).sp,
                    ),
                titleLarge =
                    TextStyle(
                        fontSize = EverplainTokens.textTitle.sp,
                        lineHeight =
                            (EverplainTokens.textTitle * EverplainTokens.textTitleLineHeight).sp,
                        fontWeight = FontWeight.Medium,
                    ),
                titleMedium =
                    TextStyle(
                        fontSize = EverplainTokens.textHeading.sp,
                        lineHeight =
                            (EverplainTokens.textHeading * EverplainTokens.textHeadingLineHeight)
                                .sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                bodyLarge =
                    TextStyle(
                        fontSize = EverplainTokens.textBody.sp,
                        lineHeight =
                            (EverplainTokens.textBody * EverplainTokens.textBodyLineHeight).sp,
                    ),
                bodyMedium =
                    TextStyle(
                        fontSize = EverplainTokens.textControl.sp,
                        lineHeight =
                            (EverplainTokens.textControl * EverplainTokens.textControlLineHeight).sp,
                    ),
                labelLarge =
                    TextStyle(
                        fontSize = EverplainTokens.textControl.sp,
                        lineHeight =
                            (EverplainTokens.textControl * EverplainTokens.textControlLineHeight)
                                .sp,
                        fontWeight = FontWeight.Medium,
                    ),
            ),
        content = { CompositionLocalProvider(LocalRippleConfiguration provides null) { content() } },
    )
}
