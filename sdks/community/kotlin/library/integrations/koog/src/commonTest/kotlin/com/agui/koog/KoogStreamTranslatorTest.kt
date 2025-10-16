package com.agui.koog

import app.cash.turbine.test
import com.agui.core.types.RunFinishedEvent
import com.agui.core.types.RunStartedEvent
import com.agui.core.types.TextMessageContentEvent
import com.agui.core.types.TextMessageEndEvent
import com.agui.core.types.TextMessageStartEvent
import com.agui.core.types.ToolCallArgsEvent
import com.agui.core.types.ToolCallEndEvent
import com.agui.core.types.ToolCallResultEvent
import com.agui.core.types.ToolCallStartEvent
import com.agui.tools.ToolExecutionContext
import com.agui.tools.ToolExecutionResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class KoogStreamTranslatorTest {

    private val translator = KoogStreamTranslator(clock = { 0L })

    @Test
    fun `translates basic message frames`() = runTest {
        val context = KoogTranslatorContext(threadId = "thread", runId = "run")
        val frames = flowOf(
            KoogStreamFrame.MessageDelta(messageId = "m1", delta = "Hello"),
            KoogStreamFrame.MessageFinished(messageId = "m1"),
            KoogStreamFrame.SessionFinished()
        )

        translator.translate(context, frames).test {
            assertIs<RunStartedEvent>(awaitItem())
            val start = awaitItem()
            assertIs<TextMessageStartEvent>(start)
            val content = awaitItem()
            assertIs<TextMessageContentEvent>(content)
            assertEquals("Hello", content.delta)
            assertIs<TextMessageEndEvent>(awaitItem())
            assertIs<RunFinishedEvent>(awaitItem())
            awaitComplete()
        }
    }

    @Test
    fun `executes koog tool requests`() = runTest {
        val registry = koogToolRegistry {
            tool(
                name = "echo",
                description = "Echo value",
                parameters = buildJsonObject { put("type", JsonPrimitive("object")) }
            ) {
                ToolExecutionResult.success(
                    result = buildJsonObject { put("echo", JsonPrimitive(toolCall.function.arguments)) }
                )
            }
        }

        val toolCall = com.agui.core.types.ToolCall(
            id = "call-1",
            function = com.agui.core.types.FunctionCall(
                name = "echo",
                arguments = "{\"value\":1}"
            )
        )

        val context = KoogTranslatorContext(threadId = "thread", runId = "run")
        val frames = flowOf(
            KoogStreamFrame.ToolExecutionRequest(toolCall = toolCall),
            KoogStreamFrame.SessionFinished()
        )

        translator.translate(context, frames, registry).test {
            assertIs<RunStartedEvent>(awaitItem())
            assertIs<ToolCallStartEvent>(awaitItem())
            assertIs<ToolCallArgsEvent>(awaitItem())
            assertIs<ToolCallEndEvent>(awaitItem())
            val result = awaitItem()
            assertIs<ToolCallResultEvent>(result)
            assertEquals("call-1", result.toolCallId)
            assertTrue(result.content.contains("\"success\":true"))
            assertIs<RunFinishedEvent>(awaitItem())
            awaitComplete()
        }
    }
}
