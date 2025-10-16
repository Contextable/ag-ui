package com.agui.koog

import com.agui.core.types.Tool
import com.agui.core.types.ToolCall
import com.agui.tools.ToolExecutionContext
import com.agui.tools.ToolExecutionResult
import com.agui.tools.ToolExecutor
import com.agui.tools.ToolRegistry
import com.agui.tools.ToolRegistryBuilder
import com.agui.tools.ToolValidationResult
import com.agui.tools.toolRegistry
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Metadata that augments a tool definition with Koog-specific hints.
 */
data class KoogToolDefinition(
    val tool: Tool,
    val returnsSchema: JsonElement? = null,
    val summary: String? = null,
    val timeoutMs: Long? = null,
    val metadata: JsonObject = JsonObject(emptyMap())
)

/**
 * Wrapper around the core [ToolRegistry] that keeps Koog-specific metadata.
 */
class KoogToolRegistry internal constructor(
    private val delegate: ToolRegistry,
    val definitions: List<KoogToolDefinition>
) : ToolRegistry by delegate {

    val tools: List<Tool> = definitions.map { it.tool }

    fun definitionFor(name: String): KoogToolDefinition? =
        definitions.firstOrNull { it.tool.name == name }

    companion object {
        fun empty(): KoogToolRegistry = KoogToolRegistry(toolRegistry(), emptyList())
    }
}

/**
 * Builder DSL that registers [ToolExecutor] instances while also capturing
 * Koog metadata about each tool.
 */
class KoogToolRegistryBuilder {
    private val registryBuilder = ToolRegistryBuilder()
    private val definitions = mutableListOf<KoogToolDefinition>()

    fun register(
        executor: ToolExecutor,
        returns: JsonElement? = null,
        summary: String? = null,
        metadata: JsonObject = JsonObject(emptyMap())
    ): KoogToolRegistryBuilder {
        registryBuilder.addTool(executor)
        definitions += KoogToolDefinition(
            tool = executor.tool,
            returnsSchema = returns,
            summary = summary,
            timeoutMs = executor.getMaxExecutionTimeMs(),
            metadata = metadata
        )
        return this
    }

    fun tool(
        name: String,
        description: String,
        parameters: JsonElement,
        returns: JsonElement? = null,
        summary: String? = null,
        timeoutMs: Long? = null,
        metadata: JsonObject = JsonObject(emptyMap()),
        validator: (ToolCall) -> ToolValidationResult = { ToolValidationResult.success() },
        handler: suspend ToolExecutionContext.() -> ToolExecutionResult
    ): KoogToolRegistryBuilder {
        val tool = Tool(name = name, description = description, parameters = parameters)
        val executor = object : ToolExecutor {
            override val tool: Tool = tool

            override suspend fun execute(context: ToolExecutionContext): ToolExecutionResult = handler(context)

            override fun validate(toolCall: ToolCall): ToolValidationResult = validator(toolCall)

            override fun getMaxExecutionTimeMs(): Long? = timeoutMs
        }
        return register(executor, returns, summary, metadata)
    }

    fun build(): KoogToolRegistry {
        val registry = registryBuilder.build()
        return KoogToolRegistry(registry, definitions.toList())
    }
}

fun koogToolRegistry(builder: KoogToolRegistryBuilder.() -> Unit): KoogToolRegistry =
    KoogToolRegistryBuilder().apply(builder).build()
