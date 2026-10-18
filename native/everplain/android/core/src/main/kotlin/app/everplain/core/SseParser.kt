package app.everplain.core

/** Incremental, bounded SSE line parser. Network UTF-8 decoding belongs to Okio. */
data class SseFrame(val event: String, val data: String)

class SseParser(private val maximumCharacters: Int = 1_048_576) {
    private var firstLine = true
    private var event = "message"
    private val data = StringBuilder()
    private var size = 0

    fun line(input: String): SseFrame? {
        val line = if (firstLine) input.removePrefix("\uFEFF") else input
        firstLine = false
        if (line.isEmpty()) {
            val frame =
                if (data.isNotEmpty()) SseFrame(event, data.dropLast(1).toString()) else null
            event = "message"
            data.setLength(0)
            size = 0
            return frame
        }
        size += line.length
        require(size <= maximumCharacters) { "SSE event exceeds the safe size limit" }
        if (line.startsWith(':')) return null
        val separator = line.indexOf(':')
        val name = if (separator < 0) line else line.substring(0, separator)
        val value = if (separator < 0) "" else line.substring(separator + 1).removePrefix(" ")
        when (name) {
            "event" -> event = value
            "data" -> data.append(value).append('\n')
        }
        return null
    }
    // Do not flush a partial frame at EOF: only blank-line-delimited events are valid.
}

/** Byte framing handles LF, CRLF and lone CR without corrupting split UTF-8 code points. */
class SseDecoder(private val maximumBytes: Int = 1_048_576) {
    private val parser = SseParser(maximumBytes)
    private val line = java.io.ByteArrayOutputStream()
    private var skipLF = false

    fun feed(bytes: ByteArray): List<SseFrame> {
        val frames = mutableListOf<SseFrame>()
        bytes.forEach { byte ->
            val value = byte.toInt() and 255
            if (skipLF) {
                skipLF = false
                if (value == 10) return@forEach
            }
            if (value == 10 || value == 13) {
                parser.line(line.toString(Charsets.UTF_8.name()))?.let(frames::add)
                line.reset()
                skipLF = value == 13
            } else {
                require(line.size() < maximumBytes) { "SSE line exceeds the safe size limit" }
                line.write(value)
            }
        }
        return frames
    }
}
