package com.agui.integrations.koog.tools

import com.agui.core.types.FunctionCall
import com.agui.core.types.Tool
import com.agui.core.types.ToolCall
import com.agui.core.types.ToolMessage
import kotlinx.serialization.json.JsonElement

/**
 * Represents a tool invocation emitted by Koog after translating its internal
 * `ToolCallInfo` structure. The adapter keeps the structure intentionally
 * minimal so that real Koog call objects can be mapped via extension
 * functions without introducing binary dependencies.
 */
data class KoogToolCall(
    val id: String,
    val name: String,
    val argumentsJson: String,
    val parentMessageId: String? = null
)

/**
 * Canonical AG-UI representation of a tool invocation.
 */
data class AguiToolInvocation(
    val toolCallId: String,
    val toolName: String,
    val argumentsJson: String,
    val parentMessageId: String? = null
) {
    fun toToolCall(): ToolCall = ToolCall(
        id = toolCallId,
        function = FunctionCall(
            name = toolName,
            arguments = argumentsJson
        )
    )
}

/**
 * Result returned by a tool handler. The adapter turns this into a
 * `ToolMessage` for AG-UI clients and a `ToolResult` frame for Koog.
 */
data class AguiToolResponse(
    val toolCallId: String,
    val messageId: String,
    val content: String,
    val toolName: String? = null,
    val role: String = "tool"
) {
    fun toToolMessage(): ToolMessage = ToolMessage(
        id = messageId,
        content = content,
        toolCallId = toolCallId,
        name = toolName
    )
}

fun KoogToolCall.toAguiInvocation(): AguiToolInvocation = AguiToolInvocation(
    toolCallId = id,
    toolName = name,
    argumentsJson = argumentsJson,
    parentMessageId = parentMessageId
)

/**
 * DSL entry describing a tool that should be registered with both Koog and
 * AG-UI clients.
 */
data class KoogToolDefinition(
    val aguiTool: Tool,
    val returnsSchema: JsonElement?,
    val handler: suspend (AguiToolInvocation) -> AguiToolResponse
)

/**
 * Builder used to assemble Koog/AG-UI tool registries from a single DSL.
 */
class KoogToolRegistryBuilder {
    private val definitions = mutableListOf<KoogToolDefinition>()

    fun jsonTool(
        name: String,
        description: String,
        parametersSchema: JsonElement,
        returnsSchema: JsonElement? = null,
        handler: suspend (AguiToolInvocation) -> AguiToolResponse
    ) {
        val tool = Tool(
            name = name,
            description = description,
            parameters = parametersSchema
        )
        definitions += KoogToolDefinition(tool, returnsSchema, handler)
    }

    internal fun build(): KoogToolRegistry = KoogToolRegistry(definitions.toList())
}

fun buildKoogToolRegistry(block: KoogToolRegistryBuilder.() -> Unit): KoogToolRegistry =
    KoogToolRegistryBuilder().apply(block).build()

/**
 * Composite registry storing the tool metadata and execution handlers.
 */
class KoogToolRegistry internal constructor(
    private val definitions: List<KoogToolDefinition>
) {
    val aguiTools: List<Tool> = definitions.map { it.aguiTool }

    suspend fun dispatch(invocation: AguiToolInvocation): AguiToolResponse? =
        definitions.firstOrNull { it.aguiTool.name == invocation.toolName }?.handler?.invoke(invocation)

    fun describe(name: String): KoogToolDefinition? =
        definitions.firstOrNull { it.aguiTool.name == name }

    fun resultSchema(name: String): JsonElement? = describe(name)?.returnsSchema
}
