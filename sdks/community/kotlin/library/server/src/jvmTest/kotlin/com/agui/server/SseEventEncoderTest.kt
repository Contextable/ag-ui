package com.agui.server

import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunErrorEvent
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

class SseEventEncoderTest {
    @Test
    fun `uses default AgUiJson serializer`() {
        val event = RunErrorEvent(message = "default", code = "SERVER_ERROR")
        val encoder = SseEventEncoder()

        val encoded = encoder.encode(event)

        assertEquals(AgUiJson.encodeToString(BaseEvent.serializer(), event), encoded)
    }

    @Test
    fun `respects custom json serializer`() {
        val event = RunErrorEvent(message = "custom", code = "SERVER_ERROR")
        val customJson = Json {
            prettyPrint = true
            encodeDefaults = true
        }
        val encoder = SseEventEncoder(json = customJson)

        val encoded = encoder.encode(event)

        assertEquals(customJson.encodeToString(BaseEvent.serializer(), event), encoded)
    }
}
