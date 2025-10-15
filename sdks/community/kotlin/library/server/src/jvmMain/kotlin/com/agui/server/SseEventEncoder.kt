package com.agui.server

import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Encodes AG-UI events as Server-Sent Events (SSE) payloads.
 *
 * By default this uses the shared [AgUiJson] serializer so encoded events are
 * compatible with the Kotlin and TypeScript clients.
 */
class SseEventEncoder(
    private val json: Json = AgUiJson
) {
    /**
     * Convert a [BaseEvent] into the JSON payload used inside the SSE `data:` field.
     */
    fun encode(event: BaseEvent): String = json.encodeToString(event)
}
