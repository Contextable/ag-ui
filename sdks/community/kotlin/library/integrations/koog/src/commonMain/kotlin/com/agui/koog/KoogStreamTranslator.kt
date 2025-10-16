package com.agui.koog

import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import com.agui.core.types.CustomEvent
import com.agui.core.types.MessagesSnapshotEvent
import com.agui.core.types.RawEvent
import com.agui.core.types.RunErrorEvent
import com.agui.core.types.RunFinishedEvent
import com.agui.core.types.RunStartedEvent
import com.agui.core.types.StateDeltaEvent
import com.agui.core.types.StateSnapshotEvent
import com.agui.core.types.StepFinishedEvent
import com.agui.core.types.StepStartedEvent
import com.agui.core.types.TextMessageContentEvent
import com.agui.core.types.TextMessageEndEvent
import com.agui.core.types.TextMessageStartEvent
import com.agui.core.types.ThinkingEndEvent
import com.agui.core.types.ThinkingStartEvent
import com.agui.core.types.ThinkingTextMessageContentEvent
import com.agui.core.types.ThinkingTextMessageEndEvent
import com.agui.core.types.ThinkingTextMessageStartEvent
import com.agui.core.types.ToolCallArgsEvent
import com.agui.core.types.ToolCallEndEvent
import com.agui.core.types.ToolCallResultEvent
import com.agui.core.types.ToolCallStartEvent
import co.touchlab.kermit.Logger
import com.agui.tools.ToolExecutionContext
import com.agui.tools.ToolExecutionException
import com.agui.tools.ToolExecutionResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

private val logger = Logger.withTag("KoogStreamTranslator")

/**
 * Converts Koog stream frames into AG-UI protocol events.
 */
class KoogStreamTranslator(
    private val json: Json = AgUiJson,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {
    fun translate(
        context: KoogTranslatorContext,
        frames: Flow<KoogStreamFrame>,
        toolRegistry: KoogToolRegistry? = null
    ): Flow<BaseEvent> = flow {
        var threadId = context.threadId
        var runId = context.runId
        var runStarted = false
        var runFinished = false

        val activeMessages = mutableSetOf<String>()
        val activeThinking = mutableSetOf<String>()
        val activeToolCalls = mutableSetOf<String>()

        suspend fun emitRunStarted(timestamp: Long?) {
            if (!runStarted) {
                val event = RunStartedEvent(
                    threadId = threadId,
                    runId = runId,
                    timestamp = timestamp ?: context.startTimestamp ?: clock()
                )
                emit(event)
                runStarted = true
            }
        }

        if (context.autoStartRun) {
            emitRunStarted(context.startTimestamp)
        }

        if (context.includeInitialMessages && context.initialMessages.isNotEmpty()) {
            emit(MessagesSnapshotEvent(context.initialMessages, context.startTimestamp ?: clock()))
        }

        if (context.includeInitialState && context.initialState != null) {
            emit(StateSnapshotEvent(context.initialState, context.startTimestamp ?: clock()))
        }

        try {
            frames.collect { frame ->
                when (frame) {
                    is KoogStreamFrame.SessionStarted -> {
                        frame.threadId?.let { threadId = it }
                        frame.runId?.let { newRunId ->
                            if (runStarted && newRunId != runId) {
                                logger.w { "Koog stream updated runId after start: $runId -> $newRunId" }
                            }
                            runId = newRunId
                        }
                        emitRunStarted(frame.timestamp)
                    }

                    is KoogStreamFrame.SessionFinished -> {
                        emitRunStarted(frame.timestamp)
                        emit(RunFinishedEvent(threadId, runId, frame.timestamp ?: clock()))
                        runFinished = true
                    }

                    is KoogStreamFrame.SessionError -> {
                        emitRunStarted(frame.timestamp)
                        emit(
                            RunErrorEvent(
                                message = frame.message,
                                code = frame.code,
                                timestamp = frame.timestamp ?: clock(),
                                rawEvent = frame.raw
                            )
                        )
                        runFinished = true
                    }

                    is KoogStreamFrame.StepStarted -> {
                        emitRunStarted(frame.timestamp)
                        emit(StepStartedEvent(frame.name, frame.timestamp, frame.raw))
                    }

                    is KoogStreamFrame.StepFinished -> {
                        emitRunStarted(frame.timestamp)
                        emit(StepFinishedEvent(frame.name, frame.timestamp, frame.raw))
                    }

                    is KoogStreamFrame.ThinkingStarted -> {
                        emitRunStarted(frame.timestamp)
                        emit(ThinkingStartEvent(frame.title, frame.timestamp, frame.raw))
                    }

                    is KoogStreamFrame.ThinkingFinished -> {
                        emitRunStarted(frame.timestamp)
                        emit(ThinkingEndEvent(frame.timestamp, frame.raw))
                    }

                    is KoogStreamFrame.MessageStarted -> {
                        emitRunStarted(frame.timestamp)
                        when (frame.channel) {
                            KoogMessageChannel.FINAL -> if (activeMessages.add(frame.messageId)) {
                                emit(TextMessageStartEvent(frame.messageId, frame.timestamp, frame.raw))
                            }
                            KoogMessageChannel.THINKING -> if (activeThinking.add(frame.messageId)) {
                                emit(ThinkingTextMessageStartEvent(frame.timestamp, frame.raw))
                            }
                        }
                    }

                    is KoogStreamFrame.MessageDelta -> {
                        emitRunStarted(frame.timestamp)
                        when (frame.channel) {
                            KoogMessageChannel.FINAL -> {
                                if (activeMessages.add(frame.messageId)) {
                                    emit(TextMessageStartEvent(frame.messageId, frame.timestamp, frame.raw))
                                }
                                if (frame.delta.isNotEmpty()) {
                                    emit(TextMessageContentEvent(frame.messageId, frame.delta, frame.timestamp, frame.raw))
                                }
                            }
                            KoogMessageChannel.THINKING -> {
                                if (activeThinking.add(frame.messageId)) {
                                    emit(ThinkingTextMessageStartEvent(frame.timestamp, frame.raw))
                                }
                                if (frame.delta.isNotEmpty()) {
                                    emit(ThinkingTextMessageContentEvent(frame.delta, frame.timestamp, frame.raw))
                                }
                            }
                        }
                    }

                    is KoogStreamFrame.MessageFinished -> {
                        emitRunStarted(frame.timestamp)
                        when (frame.channel) {
                            KoogMessageChannel.FINAL -> if (activeMessages.remove(frame.messageId)) {
                                emit(TextMessageEndEvent(frame.messageId, frame.timestamp, frame.raw))
                            }
                            KoogMessageChannel.THINKING -> if (activeThinking.remove(frame.messageId)) {
                                emit(ThinkingTextMessageEndEvent(frame.timestamp, frame.raw))
                            }
                        }
                    }

                    is KoogStreamFrame.ToolCallStarted -> {
                        emitRunStarted(frame.timestamp)
                        if (activeToolCalls.add(frame.toolCallId)) {
                            emit(
                                ToolCallStartEvent(
                                    toolCallId = frame.toolCallId,
                                    toolCallName = frame.toolName,
                                    parentMessageId = frame.parentMessageId,
                                    timestamp = frame.timestamp,
                                    rawEvent = frame.raw
                                )
                            )
                        }
                    }

                    is KoogStreamFrame.ToolCallArgsChunk -> {
                        emitRunStarted(frame.timestamp)
                        emit(
                            ToolCallArgsEvent(
                                toolCallId = frame.toolCallId,
                                delta = frame.delta,
                                timestamp = frame.timestamp,
                                rawEvent = frame.raw
                            )
                        )
                    }

                    is KoogStreamFrame.ToolCallFinished -> {
                        emitRunStarted(frame.timestamp)
                        if (activeToolCalls.remove(frame.toolCallId)) {
                            emit(ToolCallEndEvent(frame.toolCallId, frame.timestamp, frame.raw))
                        }
                    }

                    is KoogStreamFrame.ToolExecutionRequest -> {
                        emitRunStarted(frame.timestamp)
                        val toolCall = frame.toolCall
                        if (activeToolCalls.add(toolCall.id)) {
                            emit(
                                ToolCallStartEvent(
                                    toolCallId = toolCall.id,
                                    toolCallName = toolCall.function.name,
                                    parentMessageId = frame.parentMessageId,
                                    timestamp = frame.timestamp,
                                    rawEvent = frame.raw
                                )
                            )
                        }
                        emit(
                            ToolCallArgsEvent(
                                toolCallId = toolCall.id,
                                delta = toolCall.function.arguments,
                                timestamp = frame.timestamp,
                                rawEvent = frame.raw
                            )
                        )
                        emit(ToolCallEndEvent(toolCall.id, frame.timestamp, frame.raw))
                        activeToolCalls.remove(toolCall.id)

                        val registry = toolRegistry
                        if (registry == null) {
                            logger.w { "Received tool execution request but no Koog tool registry is configured" }
                        } else {
                            val contextMetadata = frame.metadata.mapNotNull { (key, value) ->
                                value?.let { key to it }
                            }.toMap()
                            val result = try {
                                registry.executeTool(
                                    ToolExecutionContext(
                                        toolCall = toolCall,
                                        threadId = threadId,
                                        runId = runId,
                                        metadata = contextMetadata
                                    )
                                )
                            } catch (error: ToolExecutionException) {
                                logger.e(error) { "Koog tool execution failed" }
                                ToolExecutionResult.failure(
                                    message = error.message ?: "Koog tool execution failed",
                                    result = null
                                )
                            }

                            val responsePayload = buildJsonObject {
                                put("success", JsonPrimitive(result.success))
                                result.message?.let { put("message", JsonPrimitive(it)) }
                                result.result?.let { put("data", it) }
                            }

                            emit(
                                ToolCallResultEvent(
                                    messageId = frame.resultMessageId ?: toolCall.id,
                                    toolCallId = toolCall.id,
                                    content = json.encodeToString(JsonElement.serializer(), responsePayload),
                                    role = "tool",
                                    timestamp = frame.timestamp ?: clock(),
                                    rawEvent = frame.raw
                                )
                            )
                        }
                    }

                    is KoogStreamFrame.ToolResult -> {
                        emitRunStarted(frame.timestamp)
                        emit(
                            ToolCallResultEvent(
                                messageId = frame.messageId,
                                toolCallId = frame.toolCallId,
                                content = json.encodeToString(JsonElement.serializer(), frame.content),
                                role = "tool",
                                timestamp = frame.timestamp ?: clock(),
                                rawEvent = frame.raw
                            )
                        )
                    }

                    is KoogStreamFrame.StateSnapshot -> {
                        emitRunStarted(frame.timestamp)
                        emit(StateSnapshotEvent(frame.snapshot, frame.timestamp ?: clock(), frame.raw))
                    }

                    is KoogStreamFrame.StateDelta -> {
                        emitRunStarted(frame.timestamp)
                        emit(StateDeltaEvent(frame.patch, frame.timestamp ?: clock(), frame.raw))
                    }

                    is KoogStreamFrame.MessagesSnapshot -> {
                        emitRunStarted(frame.timestamp)
                        emit(MessagesSnapshotEvent(frame.messages, frame.timestamp ?: clock(), frame.raw))
                    }

                    is KoogStreamFrame.Custom -> {
                        emitRunStarted(frame.timestamp)
                        emit(CustomEvent(frame.name, frame.payload, frame.timestamp ?: clock(), frame.raw))
                    }

                    is KoogStreamFrame.Raw -> {
                        emitRunStarted(frame.timestamp)
                        emit(RawEvent(frame.payload, frame.source, frame.timestamp ?: clock(), frame.payload))
                    }
                }
            }
        } catch (error: Throwable) {
            logger.e(error) { "Koog stream failed" }
            emitRunStarted(clock())
            emit(
                RunErrorEvent(
                    message = error.message ?: "Koog stream failure",
                    code = "KOOG_STREAM_ERROR",
                    timestamp = clock()
                )
            )
            runFinished = true
        }

        if (runStarted && !runFinished) {
            emit(RunFinishedEvent(threadId, runId, clock()))
        }
    }
}
