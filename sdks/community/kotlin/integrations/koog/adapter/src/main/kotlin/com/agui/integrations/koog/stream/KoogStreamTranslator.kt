package com.agui.integrations.koog.stream

import com.agui.core.types.BaseEvent
import com.agui.core.types.MessagesSnapshotEvent
import com.agui.core.types.RunErrorEvent
import com.agui.core.types.RunFinishedEvent
import com.agui.core.types.RunStartedEvent
import com.agui.core.types.StateDeltaEvent
import com.agui.core.types.StateSnapshotEvent
import com.agui.core.types.TextMessageChunkEvent
import com.agui.core.types.ToolCallArgsEvent
import com.agui.core.types.ToolCallEndEvent
import com.agui.core.types.ToolCallResultEvent
import com.agui.core.types.ToolCallStartEvent
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Converts Koog [KoogStreamFrame] sequences into AG-UI [BaseEvent] streams.
 */
class KoogStreamTranslator(
    private val timestampProvider: () -> Long? = { null }
) {
    /**
     * Translate a Koog stream into AG-UI events.
     */
    fun translate(
        threadId: String,
        runId: String,
        frames: Flow<KoogStreamFrame>
    ): Flow<BaseEvent> = channelFlow {
        send(RunStartedEvent(threadId = threadId, runId = runId, timestamp = timestampProvider()))

        val openToolCalls = mutableMapOf<String, String>()
        val completedToolCalls = mutableSetOf<String>()
        var terminalEventEmitted = false

        suspend fun emit(event: BaseEvent) {
            send(event)
        }

        suspend fun ensureToolStart(frame: KoogStreamFrame.ToolCallDelta) {
            if (!openToolCalls.containsKey(frame.toolCallId)) {
                openToolCalls[frame.toolCallId] = frame.toolName
                emit(
                    ToolCallStartEvent(
                        toolCallId = frame.toolCallId,
                        toolCallName = frame.toolName,
                        parentMessageId = frame.parentMessageId,
                        timestamp = timestampProvider()
                    )
                )
            }
        }

        try {
            frames.collect { frame ->
                when (frame) {
                    is KoogStreamFrame.Append -> {
                        emit(
                            TextMessageChunkEvent(
                                messageId = frame.messageId,
                                delta = frame.delta,
                                timestamp = timestampProvider()
                            )
                        )
                    }

                    is KoogStreamFrame.ToolCallDelta -> {
                        ensureToolStart(frame)
                        emit(
                            ToolCallArgsEvent(
                                toolCallId = frame.toolCallId,
                                delta = frame.argumentsChunk,
                                timestamp = timestampProvider()
                            )
                        )
                        if (frame.isFinalChunk && completedToolCalls.add(frame.toolCallId)) {
                            emit(
                                ToolCallEndEvent(
                                    toolCallId = frame.toolCallId,
                                    timestamp = timestampProvider()
                                )
                            )
                        }
                    }

                    is KoogStreamFrame.ToolResult -> {
                        if (completedToolCalls.add(frame.toolCallId)) {
                            emit(
                                ToolCallEndEvent(
                                    toolCallId = frame.toolCallId,
                                    timestamp = timestampProvider()
                                )
                            )
                        }
                        emit(
                            ToolCallResultEvent(
                                messageId = frame.resultMessageId,
                                toolCallId = frame.toolCallId,
                                content = frame.content,
                                role = frame.role,
                                timestamp = timestampProvider()
                            )
                        )
                        openToolCalls.remove(frame.toolCallId)
                    }

                    is KoogStreamFrame.StateSnapshot -> {
                        emit(
                            StateSnapshotEvent(
                                snapshot = frame.snapshot,
                                timestamp = timestampProvider()
                            )
                        )
                    }

                    is KoogStreamFrame.StateDelta -> {
                        emit(
                            StateDeltaEvent(
                                delta = frame.delta,
                                timestamp = timestampProvider()
                            )
                        )
                    }

                    is KoogStreamFrame.MessagesSnapshot -> {
                        emit(
                            MessagesSnapshotEvent(
                                messages = frame.messages,
                                timestamp = timestampProvider()
                            )
                        )
                    }

                    is KoogStreamFrame.End -> {
                        frame.finalState?.let {
                            emit(
                                StateSnapshotEvent(
                                    snapshot = it,
                                    timestamp = timestampProvider()
                                )
                            )
                        }
                        if (frame.finalMessages.isNotEmpty()) {
                            emit(
                                MessagesSnapshotEvent(
                                    messages = frame.finalMessages,
                                    timestamp = timestampProvider()
                                )
                            )
                        }
                        emit(RunFinishedEvent(threadId = threadId, runId = runId, timestamp = timestampProvider()))
                        terminalEventEmitted = true
                    }

                    is KoogStreamFrame.Error -> {
                        emit(
                            RunErrorEvent(
                                message = frame.message,
                                code = frame.code,
                                timestamp = timestampProvider(),
                                rawEvent = frame.raw
                            )
                        )
                        terminalEventEmitted = true
                    }
                }
            }
        } catch (error: Throwable) {
            emit(
                RunErrorEvent(
                    message = error.message ?: "Koog stream failure",
                    code = "KOOG_STREAM_ERROR",
                    timestamp = timestampProvider(),
                    rawEvent = error.asRawJson()
                )
            )
            terminalEventEmitted = true
        }

        if (!terminalEventEmitted) {
            emit(RunFinishedEvent(threadId = threadId, runId = runId, timestamp = timestampProvider()))
        }

        close()
        awaitClose { }
    }
}

private fun Throwable.asRawJson(): JsonElement = buildJsonObject {
    put("exception", this@asRawJson::class.qualifiedName ?: this@asRawJson::class.simpleName)
    put("message", this@asRawJson.message ?: "")
    put("cause", this@asRawJson.cause?.let { JsonPrimitive(it.message ?: it::class.qualifiedName ?: "") } ?: JsonNull)
}
