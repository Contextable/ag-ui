package com.agui.koog

import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import com.agui.core.types.Tool
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Wraps a Koog [KoogAgent] and exposes an AG-UI friendly interface that emits
 * protocol events.
 */
class KoogAguiAgent(
    private val agent: KoogAgent,
    private val translator: KoogStreamTranslator = KoogStreamTranslator(),
    private val toolRegistry: KoogToolRegistry = KoogToolRegistry.empty(),
    private val contextFactory: (RunAgentInput) -> KoogTranslatorContext = { input ->
        KoogTranslatorContext(
            threadId = input.threadId,
            runId = input.runId,
            initialState = input.state,
            includeInitialState = input.state.shouldEmitSnapshot(),
            initialMessages = input.messages,
            includeInitialMessages = input.messages.isNotEmpty()
        )
    }
) {

    /** List of tools exposed to AG-UI clients. */
    val tools: List<Tool> get() = toolRegistry.tools

    /** Executes the Koog agent and returns the translated AG-UI event stream. */
    fun stream(input: RunAgentInput): Flow<BaseEvent> {
        val context = contextFactory(input)
        val koogInput = KoogAgentInput(
            threadId = input.threadId,
            runId = input.runId,
            state = input.state,
            messages = input.messages,
            availableTools = resolveTools(input.tools, toolRegistry.tools),
            context = input.context,
            forwardedProps = input.forwardedProps,
            toolRegistry = toolRegistry
        )
        val frames = agent.run(koogInput)
        return translator.translate(context, frames, toolRegistry)
    }

    private fun resolveTools(clientTools: List<Tool>, registeredTools: List<Tool>): List<Tool> {
        if (registeredTools.isEmpty()) return clientTools
        val registeredNames = registeredTools.map { it.name }.toSet()
        val merged = clientTools.filterNot { it.name in registeredNames } + registeredTools
        return merged.distinctBy { it.name }
    }
}

private fun JsonElement.shouldEmitSnapshot(): Boolean {
    return when (this) {
        is JsonObject -> this.isNotEmpty()
        else -> true
    }
}
