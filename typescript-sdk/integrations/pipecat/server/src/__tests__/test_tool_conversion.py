"""Focused tests for AGUIRunProcessor tool conversion helpers."""

import asyncio
import unittest
from unittest.mock import AsyncMock, Mock

from agui_bridge import AGUIObserver
from agui_integration import AGUIRunProcessor
from pipecat.adapters.schemas.tools_schema import FunctionSchema, ToolsSchema


class DummyTool:
    def __init__(self, name: str, description: str, parameters: dict):
        self.name = name
        self.description = description
        self.parameters = parameters


class DummyMessage:
    def __init__(self, *, role: str, content: str = "", message_id: str | None = None, tool_call_id: str | None = None):
        self.role = role
        self.content = content
        self.id = message_id
        self.message_id = message_id
        self.tool_call_id = tool_call_id


class DummyToolResult:
    def __init__(self, *, tool_call_id: str, content: str):
        self.role = "tool"
        self.tool_call_id = tool_call_id
        self.content = content


class AGUIRunProcessorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.observer = AGUIObserver(debug=False)
        self.processor = AGUIRunProcessor(self.observer)
        self.llm_service = Mock()
        self.services = {"llm": self.llm_service}
        self.task = AsyncMock()

    def test_convert_agui_tools_to_pipecat(self):
        tools = [
            DummyTool(
                name="get_weather",
                description="Get the current weather",
                parameters={
                    "type": "object",
                    "properties": {"location": {"type": "string"}},
                    "required": ["location"],
                },
            )
        ]

        result = self.processor.convert_agui_tools_to_pipecat(tools)

        self.assertIsInstance(result, ToolsSchema)
        self.assertEqual(len(result.standard_tools), 1)
        fn: FunctionSchema = result.standard_tools[0]
        self.assertEqual(fn.name, "get_weather")
        self.assertEqual(fn.description, "Get the current weather")
        self.assertEqual(fn.properties["location"]["type"], "string")
        self.assertEqual(fn.required, ["location"])

    def test_register_tool_handlers_registers_all_tools(self):
        tools = [DummyTool("tool_one", "First", {}), DummyTool("tool_two", "Second", {})]

        asyncio.run(self.processor.register_tool_handlers(tools, self.llm_service))

        self.assertEqual(self.llm_service.register_function.call_count, 2)
        registered_names = [call.args[0] for call in self.llm_service.register_function.call_args_list]
        self.assertListEqual(registered_names, ["tool_one", "tool_two"])

    def test_process_agui_input_queues_expected_frames(self):
        tool = DummyTool(
            name="calculate",
            description="Perform calculation",
            parameters={"type": "object", "properties": {"value": {"type": "number"}}},
        )

        input_messages = [
            DummyMessage(role="user", content="What is 2+2?", message_id="u1"),
            DummyMessage(role="tool", tool_call_id="t1"),
        ]
        self.observer.tool_call_metadata["t1"] = {"function_name": "calculate", "arguments": {"value": 4}}

        class InputData:
            def __init__(self):
                self.tools = [tool]
                self.messages = input_messages

        asyncio.run(self.processor.process_agui_input(InputData(), self.services, self.task))

        self.task.queue_frames.assert_awaited()
        queued = self.task.queue_frames.await_args.args[0]
        self.assertGreaterEqual(len(queued), 2)


if __name__ == "__main__":
    unittest.main()
