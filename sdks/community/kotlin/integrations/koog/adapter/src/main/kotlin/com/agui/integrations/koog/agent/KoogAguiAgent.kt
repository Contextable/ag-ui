package com.agui.integrations.koog.agent

import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import com.agui.integrations.koog.stream.KoogStreamFrame
import com.agui.integrations.koog.stream.KoogStreamTranslator
import com.agui.integrations.koog.tools.KoogToolRegistry
import kotlinx.coroutines.flow.Flow

/**
 * Adapter that exposes a Koog [KoogAgentRunner] as an AG-UI compliant
 * runner. The class keeps the contract intentionally tiny – real Koog
 * agents can implement [KoogAgentRunner] by delegating to JetBrains Koog
 * APIs while the adapter is responsible for translating the resulting
 * stream frames into AG-UI [BaseEvent]s.
 */
class KoogAguiAgent(
    private val koogRunner: KoogAgentRunner,
    private val translator: KoogStreamTranslator = KoogStreamTranslator(),
    private val toolRegistry: KoogToolRegistry? = null
) {
    fun run(input: RunAgentInput): Flow<BaseEvent> {
        val context = KoogAgentContext(
            input = input,
            toolRegistry = toolRegistry
        )
        val frames = koogRunner.stream(context)
        return translator.translate(
            threadId = input.threadId,
            runId = input.runId,
            frames = frames
        )
    }
}

fun KoogAguiAgent.asAguiRunner(): suspend (RunAgentInput) -> Flow<BaseEvent> = { input -> run(input) }

/**
 * Minimal context object that wraps an AG-UI [RunAgentInput] and the optional
 * tool registry built with the Koog DSL. Koog agents can use the data to
 * seed their internal storage or to wire bespoke features such as
 * persistence, debugger hooks, or replay.
 */
data class KoogAgentContext(
    val input: RunAgentInput,
    val toolRegistry: KoogToolRegistry?
)

/**
 * Functional interface representing the Koog execution surface. It receives
 * the [KoogAgentContext] and returns a cold [Flow] of [KoogStreamFrame]
 * objects. The adapter handles backpressure, event translation and error
 * reporting.
 */
fun interface KoogAgentRunner {
    fun stream(context: KoogAgentContext): Flow<KoogStreamFrame>
}
