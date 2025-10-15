package com.agui.integrations.koog

import app.cash.turbine.test
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunFinishedEvent
import com.agui.core.types.RunStartedEvent
import com.agui.core.types.TextMessageChunkEvent
import com.agui.core.types.ToolCallArgsEvent
import com.agui.core.types.ToolCallEndEvent
import com.agui.core.types.ToolCallResultEvent
import com.agui.core.types.ToolCallStartEvent
import com.agui.integrations.koog.stream.KoogStreamFrame
import com.agui.integrations.koog.stream.KoogStreamTranslator
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class KoogStreamTranslatorTest {
    private val translator = KoogStreamTranslator { 1234L }

    @Test
    fun `translates append frames into chunk events`() = runTest {
        val frames = flowOf(
            KoogStreamFrame.Append(messageId = "msg-1", delta = "Hello"),
            KoogStreamFrame.End()
        )

        translator.translate("thread", "run", frames).test {
            assertIs<RunStartedEvent>(awaitItem())
            val chunk = awaitItem()
            assertIs<TextMessageChunkEvent>(chunk)
            assertEquals("Hello", chunk.delta)
            assertIs<RunFinishedEvent>(awaitItem())
            awaitComplete()
        }
    }

    @Test
    fun `translates tool frames into AG-UI triad`() = runTest {
        val frames = flowOf(
            KoogStreamFrame.ToolCallDelta(
                toolCallId = "call-1",
                toolName = "search",
                argumentsChunk = "{\"query\":\"kotlin\"}",
                isFinalChunk = true
            ),
            KoogStreamFrame.ToolResult(
                toolCallId = "call-1",
                resultMessageId = "tool-msg",
                content = "{\"results\":[]}",
                role = "tool"
            ),
            KoogStreamFrame.End()
        )

        translator.translate("thread", "run", frames).test {
            assertIs<RunStartedEvent>(awaitItem())
            assertIs<ToolCallStartEvent>(awaitItem())
            assertIs<ToolCallArgsEvent>(awaitItem())
            val end = awaitItem()
            assertIs<ToolCallEndEvent>(end)
            val result = awaitItem()
            assertIs<ToolCallResultEvent>(result)
            assertIs<RunFinishedEvent>(awaitItem())
            awaitComplete()
        }
    }

    @Test
    fun `emits state snapshots and deltas`() = runTest {
        val frames = flowOf(
            KoogStreamFrame.StateSnapshot(buildJsonObject { put("count", 1) }),
            KoogStreamFrame.StateDelta(
                JsonArray(
                    listOf(buildJsonObject { put("op", "replace") })
                )
            ),
            KoogStreamFrame.End()
        )

        val events = mutableListOf<BaseEvent>()
        translator.translate("thread", "run", frames).collect { events += it }

        assertEquals(4, events.size)
        assertIs<RunStartedEvent>(events[0])
        assertEquals("count", (events[1] as com.agui.core.types.StateSnapshotEvent).snapshot.jsonObject.keys.first())
        assertIs<com.agui.core.types.StateDeltaEvent>(events[2])
        assertIs<RunFinishedEvent>(events[3])
    }
}
