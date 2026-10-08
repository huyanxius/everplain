package app.everplain.android

import kotlinx.serialization.Serializable

@Serializable internal data class NativeDiffPart(val kind: String, val text: String)

/**
 * Display-only scalar pairing shared with the macOS native renderer; original source parts stay
 * exact.
 */
internal fun displayDiffParts(parts: List<NativeDiffPart>): List<NativeDiffPart> {
    fun wellFormed(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val ch = text[i++]
            if (ch.isHighSurrogate()) {
                if (i >= text.length || !text[i++].isLowSurrogate()) return false
            } else if (ch.isLowSurrogate()) return false
        }
        return true
    }
    // Never remove malformed source units. Pairing applies only when each original document is
    // valid.
    if (
        !wellFormed(parts.filter { it.kind != "inserted" }.joinToString("") { it.text }) ||
            !wellFormed(parts.filter { it.kind != "deleted" }.joinToString("") { it.text })
    )
        return parts
    fun neighbor(index: Int, step: Int, kind: String): Char? {
        var position = index + step
        while (position in parts.indices) {
            val part = parts[position]
            if (part.kind == "unchanged" || part.kind == kind) {
                val unit = if (step < 0) part.text.lastOrNull() else part.text.firstOrNull()
                if (unit != null) return unit
            }
            position += step
        }
        return null
    }
    return parts.mapIndexedNotNull { index, part ->
        var text = part.text
        if (text.firstOrNull()?.isLowSurrogate() == true) {
            if (part.kind == "unchanged") text = text.drop(1)
            else
                neighbor(index, -1, part.kind)
                    ?.takeIf { it.isHighSurrogate() }
                    ?.let { text = it + text }
        }
        if (text.lastOrNull()?.isHighSurrogate() == true) {
            if (part.kind == "unchanged") text = text.dropLast(1)
            else neighbor(index, 1, part.kind)?.takeIf { it.isLowSurrogate() }?.let { text += it }
        }
        text.takeIf { it.isNotEmpty() }?.let { NativeDiffPart(part.kind, it) }
    }
}
