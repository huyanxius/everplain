package app.everplain.core

import kotlin.math.*

/** Display-only port of Web useStreamPacer; never changes the authoritative network answer. */
class StreamPacer(answer: String, streaming: Boolean, reduced: Boolean) {
    var visible: String = if (streaming && !reduced) "" else answer
        private set

    var revealedAt: List<Double> = emptyList()
        private set

    private var answer = answer
    private var streaming = streaming
    private var reduced = reduced
    private var animated = streaming && !reduced
    private var lastReveal = 0.0
    val needsTick
        get() =
            !reduced && (visible.length < answer.length || (!streaming && revealedAt.isNotEmpty()))

    fun update(answer: String, streaming: Boolean, reduced: Boolean) {
        val replaces = !answer.startsWith(this.answer)
        this.answer = answer
        this.streaming = streaming
        this.reduced = reduced
        if (reduced || replaces || (!animated && !streaming)) {
            visible = answer
            revealedAt = emptyList()
            animated = streaming && !reduced
        } else if (streaming) animated = true
    }

    fun tick(now: Double): Boolean {
        if (reduced) return false
        val backlog = answer.length - visible.length
        if (backlog > 0) {
            val count = max(1, ceil(min(420.0, 36 + backlog * 2.4) * .048).toInt())
            val start = visible.length
            var end = min(answer.length, start + count)
            if (end < answer.length && answer[end].isLowSurrogate()) end++
            val chars = answer.substring(start, end).codePoints().toArray()
            val times = revealedAt.toMutableList()
            while (times.size < start) times.add(Double.NEGATIVE_INFINITY)
            chars.forEachIndexed { i, cp ->
                repeat(Character.charCount(cp)) { times.add(now - 48 + i * 48.0 / chars.size) }
            }
            visible = answer.substring(0, end)
            revealedAt = times
            lastReveal = now
            return true
        }
        if (!streaming && revealedAt.isNotEmpty() && now - lastReveal >= 1100) {
            revealedAt = emptyList()
            animated = false
            return true
        }
        return false
    }
}

fun sourceSpring(t: Double): Double {
    val zeta = .7
    val w = 2 * PI / .7
    val wd = w * sqrt(1 - zeta * zeta)
    return 1 - exp(-zeta * w * t) * (cos(wd * t) + zeta * w / wd * sin(wd * t))
}
