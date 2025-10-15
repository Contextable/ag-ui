package com.agui.integrations.koog.stream

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Lightweight representation of the frames emitted by a Koog [AIAgent].
 *
 * The actual Koog runtime exposes a sealed hierarchy of `StreamFrame`
 * instances. Rather than depending on the Koog artifacts directly we
 * model the subset of information required by the AG-UI adapter so the
 * integration can be tested in isolation. Callers can easily map the
 * real Koog frames to this interface by extracting the same fields.
 */
sealed interface KoogStreamFrame {
    /**
     * Append chunk of assistant text.
     */
    data class Append(
        val messageId: String?,
        val delta: String,
        val metadata: Map<String, String> = emptyMap()
    ) : KoogStreamFrame

    /**
     * Append chunk of tool call arguments. Multiple chunks compose the
     * arguments JSON. The adapter converts the stream into AG-UI tool
     * call events.
     */
    data class ToolCallDelta(
        val toolCallId: String,
        val toolName: String,
        val argumentsChunk: String,
        val parentMessageId: String? = null,
        val isFinalChunk: Boolean = false
    ) : KoogStreamFrame

    /**
     * Indicates that Koog executed a tool and produced a result message.
     */
    data class ToolResult(
        val toolCallId: String,
        val resultMessageId: String,
        val content: String,
        val role: String? = "tool"
    ) : KoogStreamFrame

    /**
     * Represents a full state snapshot emitted by Koog persistence.
     */
    data class StateSnapshot(val snapshot: JsonObject) : KoogStreamFrame

    /**
     * Represents an incremental state delta expressed as RFC6902 JSON Patch.
     */
    data class StateDelta(val delta: JsonArray) : KoogStreamFrame

    /**
     * Indicates Koog produced a new message timeline snapshot.
     */
    data class MessagesSnapshot(val messages: List<com.agui.core.types.Message>) : KoogStreamFrame

    /**
     * Signals the end of the Koog stream. Optional payloads allow the
     * adapter to emit final AG-UI events such as state snapshots.
     */
    data class End(
        val finalState: JsonElement? = null,
        val finalMessages: List<com.agui.core.types.Message> = emptyList()
    ) : KoogStreamFrame

    /**
     * Encapsulates an execution error surfaced by Koog.
     */
    data class Error(
        val message: String,
        val code: String? = null,
        val raw: JsonElement? = null
    ) : KoogStreamFrame
}
