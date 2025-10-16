package com.agui.integrations.koog

import com.agui.core.types.Context
import com.agui.core.types.Message
import com.agui.core.types.Tool
import com.agui.core.types.ToolCall
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Channel used by Koog message frames to distinguish between final assistant
 * output and internal thinking content.
 */
enum class KoogMessageChannel {
    /** Final assistant messages surfaced to the user. */
    FINAL,
    /** Internal reasoning text that should be mapped to thinking events. */
    THINKING
}

/**
 * Context passed to the stream translator when converting Koog frames to
 * AG-UI events.
 */
data class KoogTranslatorContext(
    val threadId: String,
    val runId: String,
    val startTimestamp: Long? = null,
    val initialState: JsonElement? = null,
    val includeInitialState: Boolean = false,
    val initialMessages: List<Message> = emptyList(),
    val includeInitialMessages: Boolean = false,
    val autoStartRun: Boolean = true
)

/**
 * Input payload provided to Koog agents before they start streaming frames.
 */
data class KoogAgentInput(
    val threadId: String,
    val runId: String,
    val state: JsonElement,
    val messages: List<Message>,
    val availableTools: List<Tool>,
    val context: List<Context>,
    val forwardedProps: JsonElement,
    val toolRegistry: KoogToolRegistry
)

/**
 * Koog agents stream a series of frames describing lifecycle transitions,
 * message deltas and tool invocations. Each frame is translated into one or
 * more AG-UI events.
 */
sealed interface KoogStreamFrame {

    data class SessionStarted(
        val threadId: String? = null,
        val runId: String? = null,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class SessionFinished(
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class SessionError(
        val message: String,
        val code: String? = null,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class StepStarted(
        val name: String,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class StepFinished(
        val name: String,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class ThinkingStarted(
        val title: String? = null,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class ThinkingFinished(
        val title: String? = null,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class MessageStarted(
        val messageId: String,
        val channel: KoogMessageChannel = KoogMessageChannel.FINAL,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class MessageDelta(
        val messageId: String,
        val delta: String,
        val channel: KoogMessageChannel = KoogMessageChannel.FINAL,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class MessageFinished(
        val messageId: String,
        val channel: KoogMessageChannel = KoogMessageChannel.FINAL,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class ToolCallStarted(
        val toolCallId: String,
        val toolName: String,
        val parentMessageId: String? = null,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class ToolCallArgsChunk(
        val toolCallId: String,
        val delta: String,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class ToolCallFinished(
        val toolCallId: String,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class ToolExecutionRequest(
        val toolCall: ToolCall,
        val parentMessageId: String? = null,
        val resultMessageId: String? = null,
        val metadata: Map<String, Any?> = emptyMap(),
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class ToolResult(
        val messageId: String,
        val toolCallId: String,
        val content: JsonElement,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class StateSnapshot(
        val snapshot: JsonElement,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class StateDelta(
        val patch: JsonArray,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class MessagesSnapshot(
        val messages: List<Message>,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class Custom(
        val name: String,
        val payload: JsonElement,
        val timestamp: Long? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame

    data class Raw(
        val payload: JsonElement,
        val source: String? = null,
        val timestamp: Long? = null
    ) : KoogStreamFrame
}

/**
 * Simple contract that any Koog agent must satisfy in order to stream frames
 * into the AG-UI adapter.
 */
fun interface KoogAgent {
    fun run(input: KoogAgentInput): kotlinx.coroutines.flow.Flow<KoogStreamFrame>
}
