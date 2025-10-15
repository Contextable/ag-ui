package com.agui.integrations.koog

import com.agui.integrations.koog.tools.AguiToolInvocation
import com.agui.integrations.koog.tools.AguiToolResponse
import com.agui.integrations.koog.tools.KoogToolCall
import com.agui.integrations.koog.tools.buildKoogToolRegistry
import com.agui.integrations.koog.tools.toAguiInvocation
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class KoogToolBridgeTest {
    @Test
    fun `converts koog tool call into ag-ui invocation`() {
        val call = KoogToolCall(
            id = "call-42",
            name = "lookup",
            argumentsJson = "{\"id\":1}",
            parentMessageId = "msg-123"
        )

        val invocation = call.toAguiInvocation()
        assertEquals("call-42", invocation.toolCallId)
        assertEquals("lookup", invocation.toolName)
        assertEquals("msg-123", invocation.parentMessageId)
    }

    @Test
    fun `tool registry exposes ag-ui metadata and handlers`() = runTest {
        val registry = buildKoogToolRegistry {
            jsonTool(
                name = "lookup",
                description = "Look up items",
                parametersSchema = buildJsonObject { put("type", "object") }
            ) { invocation ->
                AguiToolResponse(
                    toolCallId = invocation.toolCallId,
                    messageId = "tool-result",
                    content = "{\"value\":42}",
                    toolName = invocation.toolName
                )
            }
        }

        val tool = registry.aguiTools.single()
        assertEquals("lookup", tool.name)
        assertEquals("Look up items", tool.description)

        val response = registry.dispatch(
            AguiToolInvocation(
                toolCallId = "lookup-1",
                toolName = "lookup",
                argumentsJson = "{}"
            )
        )

        assertNotNull(response)
        assertEquals("lookup-1", response.toolCallId)
        assertEquals("tool-result", response.messageId)
    }
}
