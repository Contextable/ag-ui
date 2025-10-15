package com.agui.client.transport

import co.touchlab.kermit.Logger
import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.readUTF8Line
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

private val logger = Logger.withTag("NdjsonEventParser")

/**
 * Parses newline-delimited JSON (NDJSON) payloads into AG-UI events.
 * Each line is decoded independently which matches the CopilotKit
 * transport of streaming JSON objects separated by newlines.
 */
class NdjsonEventParser(
    private val json: Json = AgUiJson
) {
    /**
     * Consumes the [ByteReadChannel] created by the HTTP response and emits
     * each decoded [BaseEvent] using the provided [emit] callback.
     */
    suspend fun parse(
        channel: ByteReadChannel,
        emit: suspend (BaseEvent) -> Unit
    ) {
        val buffer = StringBuilder()
        while (!channel.isClosedForRead) {
            val line = channel.readUTF8Line() ?: break
            if (line.isEmpty()) {
                flushBuffer(buffer, emit)
            } else {
                buffer.append(line)
                flushBuffer(buffer, emit)
            }
        }
        flushBuffer(buffer, emit)
    }

    private suspend fun flushBuffer(
        buffer: StringBuilder,
        emit: suspend (BaseEvent) -> Unit
    ) {
        if (buffer.isEmpty()) return

        val payload = buffer.toString().trim()
        buffer.clear()
        if (payload.isEmpty()) return

        try {
            val event = json.decodeFromString(BaseEvent.serializer(), payload)
            emit(event)
        } catch (error: SerializationException) {
            logger.e(error) { "Failed to parse NDJSON event: $payload" }
        } catch (error: IllegalArgumentException) {
            logger.e(error) { "Failed to parse NDJSON event: $payload" }
        }
    }
}