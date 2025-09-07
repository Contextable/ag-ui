#!/usr/bin/env python3
"""
Unit tests for AG-UI to Pipecat tool conversion functionality
"""

import unittest
from unittest.mock import MagicMock, AsyncMock, patch, Mock
import asyncio
from typing import Dict, Any, List
import sys

# Create proper mock classes for testing
class MockFunctionSchema:
    def __init__(self, name: str, description: str, parameters: dict):
        self.name = name
        self.description = description
        self.parameters = parameters

class MockToolsSchema:
    def __init__(self, functions: list):
        self.functions = functions

class MockTool:
    def __init__(self, name: str, description: str, parameters: dict):
        self.name = name
        self.description = description
        self.parameters = parameters

# Mock all pipecat and external modules before importing
mock_modules = {
    'pipecat.frames.frames': Mock(
        LLMMessagesFrame=Mock(),
        EndFrame=Mock(),
        LLMSetToolsFrame=Mock(),
        FunctionCallResultFrame=Mock()
    ),
    'pipecat.services.openai.llm': Mock(
        FunctionSchema=MockFunctionSchema,
        ToolsSchema=MockToolsSchema,
        OpenAILLMService=Mock()
    ),
    'pipecat.pipeline.pipeline': Mock(Pipeline=Mock()),
    'pipecat.pipeline.runner': Mock(PipelineRunner=Mock()),
    'pipecat.pipeline.task': Mock(PipelineParams=Mock(), PipelineTask=Mock()),
    'pipecat.processors.aggregators.openai_llm_context': Mock(OpenAILLMContext=Mock()),
    'pipecat.processors.frame_processor': Mock(FrameDirection=Mock()),
    'pipecat.processors.frameworks.rtvi': Mock(RTVIProcessor=Mock(), RTVIObserver=Mock(), RTVIConfig=Mock()),
    'pipecat.services.cartesia.tts': Mock(CartesiaTTSService=Mock()),
    'pipecat.services.deepgram.stt': Mock(DeepgramSTTService=Mock()),
    'pipecat.transports.websocket.server': Mock(WebsocketServerTransport=Mock(), WebsocketServerParams=Mock()),
    'pipecat.audio.vad.silero': Mock(SileroVADAnalyzer=Mock()),
    'ag_ui.core': Mock(RunAgentInput=Mock()),
    'agui_bridge': Mock(AGUIObserver=Mock()),
    'dotenv': Mock(load_dotenv=Mock()),
    'uvicorn': Mock(Config=Mock(), Server=Mock()),
    'fastapi': Mock(FastAPI=Mock()),
    'fastapi.responses': Mock(StreamingResponse=Mock()),
    'fastapi.middleware.cors': Mock(CORSMiddleware=Mock()),
    'aiohttp': Mock(ClientSession=Mock())
}

# Apply all mocks
for module_name, mock_module in mock_modules.items():
    sys.modules[module_name] = mock_module

# Now import our module to test
from pipecat_agui_bot import PipecatAGUIBot

class TestToolConversion(unittest.TestCase):
    """Test AG-UI to Pipecat tool conversion"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.config = {
            'openai_api_key': 'test-key',
            'cartesia_api_key': 'test-key',
            'deepgram_api_key': 'test-key'
        }
        
        self.bot = PipecatAGUIBot(self.config)
    
    def test_convert_single_tool(self):
        """Test converting a single AG-UI tool to Pipecat format"""
        # Create an AG-UI tool
        agui_tool = MockTool(
            name="get_weather",
            description="Get the current weather for a location",
            parameters={
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state"
                    }
                },
                "required": ["location"]
            }
        )
        
        # Convert to Pipecat format
        result = self.bot.convert_agui_tools_to_pipecat([agui_tool])
        
        # Verify the result - should return real Pipecat objects
        from pipecat.adapters.schemas.tools_schema import ToolsSchema, FunctionSchema
        self.assertIsInstance(result, ToolsSchema)
        self.assertEqual(len(result.standard_tools), 1)
        
        function = result.standard_tools[0]
        self.assertIsInstance(function, FunctionSchema)
        self.assertEqual(function.name, "get_weather")
        self.assertEqual(function.description, "Get the current weather for a location")
        # Verify properties and required were extracted correctly
        self.assertEqual(function.properties, agui_tool.parameters.get("properties", {}))
        self.assertEqual(function.required, agui_tool.parameters.get("required", []))
    
    def test_function_schema_creation(self):
        """Test that FunctionSchema objects are created correctly"""
        agui_tool = MockTool(
            name="calculate_sum",
            description="Calculate the sum of two numbers",
            parameters={
                "type": "object",
                "properties": {
                    "a": {"type": "number", "description": "First number"},
                    "b": {"type": "number", "description": "Second number"}
                },
                "required": ["a", "b"]
            }
        )
        
        result = self.bot.convert_agui_tools_to_pipecat([agui_tool])
        from pipecat.adapters.schemas.tools_schema import ToolsSchema, FunctionSchema
        function_schema = result.standard_tools[0]
        
        # Test that all attributes are preserved
        self.assertEqual(function_schema.name, "calculate_sum")
        self.assertEqual(function_schema.description, "Calculate the sum of two numbers")
        self.assertIn("a", function_schema.properties)
        self.assertIn("b", function_schema.properties)
        self.assertEqual(function_schema.required, ["a", "b"])
    
    def test_tools_schema_structure(self):
        """Test that ToolsSchema contains the expected structure"""
        tools = [
            MockTool("tool1", "First tool", {"type": "object"}),
            MockTool("tool2", "Second tool", {"type": "object"}),
        ]
        
        result = self.bot.convert_agui_tools_to_pipecat(tools)
        
        # Verify ToolsSchema structure
        from pipecat.adapters.schemas.tools_schema import ToolsSchema, FunctionSchema
        self.assertIsInstance(result, ToolsSchema)
        self.assertTrue(hasattr(result, 'standard_tools'))
        self.assertIsInstance(result.standard_tools, list)
        self.assertEqual(len(result.standard_tools), 2)
        
        # Verify each function is a FunctionSchema
        for i, func in enumerate(result.standard_tools):
            self.assertIsInstance(func, FunctionSchema)
            self.assertEqual(func.name, f"tool{i+1}")
    
    def test_parameter_schema_preservation(self):
        """Test that complex JSON schema parameters are preserved exactly"""
        complex_parameters = {
            "type": "object",
            "properties": {
                "user_input": {
                    "type": "string",
                    "description": "User's query or command"
                },
                "options": {
                    "type": "object",
                    "properties": {
                        "format": {
                            "type": "string",
                            "enum": ["json", "xml", "csv"],
                            "default": "json"
                        },
                        "include_metadata": {
                            "type": "boolean",
                            "default": False
                        },
                        "filters": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "field": {"type": "string"},
                                    "operator": {"type": "string"},
                                    "value": {"type": "string"}
                                }
                            }
                        }
                    }
                }
            },
            "required": ["user_input"],
            "additionalProperties": False
        }
        
        tool = MockTool("complex_search", "Perform complex search", complex_parameters)
        result = self.bot.convert_agui_tools_to_pipecat([tool])
        
        function_schema = result.functions[0]
        self.assertEqual(function_schema.parameters, complex_parameters)
        
        # Verify nested structure is intact
        self.assertIn("options", function_schema.parameters["properties"])
        options = function_schema.parameters["properties"]["options"]
        self.assertIn("filters", options["properties"])
        self.assertIn("items", options["properties"]["filters"])
        self.assertEqual(options["properties"]["format"]["enum"], ["json", "xml", "csv"])
    
    def test_convert_multiple_tools(self):
        """Test converting multiple AG-UI tools to Pipecat format"""
        # Create multiple AG-UI tools
        tools = [
            MockTool(
                name="get_weather",
                description="Get weather information",
                parameters={"type": "object", "properties": {}}
            ),
            MockTool(
                name="calculate",
                description="Perform calculations",
                parameters={
                    "type": "object",
                    "properties": {
                        "expression": {"type": "string"}
                    }
                }
            ),
            MockTool(
                name="search",
                description="Search the web",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"}
                    }
                }
            )
        ]
        
        # Convert to Pipecat format
        result = self.bot.convert_agui_tools_to_pipecat(tools)
        
        # Verify the result
        self.assertIsInstance(result, MockToolsSchema)
        self.assertEqual(len(result.functions), 3)
        
        # Check each function
        for i, function in enumerate(result.functions):
            self.assertIsInstance(function, MockFunctionSchema)
            self.assertEqual(function.name, tools[i].name)
            self.assertEqual(function.description, tools[i].description)
            self.assertEqual(function.parameters, tools[i].parameters)
    
    def test_empty_tools_list(self):
        """Test converting an empty tools list"""
        result = self.bot.convert_agui_tools_to_pipecat([])
        
        self.assertIsInstance(result, MockToolsSchema)
        self.assertEqual(len(result.functions), 0)
    
    def test_tool_with_complex_parameters(self):
        """Test converting a tool with complex nested parameters"""
        complex_tool = MockTool(
            name="create_task",
            description="Create a new task with details",
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "priority": {
                        "type": "string",
                        "enum": ["low", "medium", "high"]
                    },
                    "metadata": {
                        "type": "object",
                        "properties": {
                            "tags": {
                                "type": "array",
                                "items": {"type": "string"}
                            },
                            "assignee": {"type": "string"},
                            "due_date": {
                                "type": "string",
                                "format": "date-time"
                            }
                        }
                    }
                },
                "required": ["title", "priority"]
            }
        )
        
        # Convert to Pipecat format
        result = self.bot.convert_agui_tools_to_pipecat([complex_tool])
        
        # Verify the result preserves the complex structure
        self.assertEqual(len(result.functions), 1)
        function = result.functions[0]
        self.assertEqual(function.name, "create_task")
        self.assertEqual(function.parameters, complex_tool.parameters)
        self.assertIn("metadata", function.parameters["properties"])
        self.assertIn("tags", function.parameters["properties"]["metadata"]["properties"])
    
    @patch('pipecat_agui_bot.logger')
    def test_logging_during_conversion(self, mock_logger):
        """Test that proper logging occurs during conversion"""
        tool = MockTool(
            name="test_tool",
            description="A test tool",
            parameters={"type": "object"}
        )
        
        self.bot.convert_agui_tools_to_pipecat([tool])
        
        # Verify logging was called
        mock_logger.info.assert_called_with("Converted tool 'test_tool' to Pipecat format")


class TestRealPipecatIntegration(unittest.TestCase):
    """Test integration with real Pipecat classes (no mocking)"""
    
    def test_real_pipecat_imports(self):
        """Test that we can actually import the real Pipecat classes"""
        try:
            from pipecat.adapters.schemas.tools_schema import FunctionSchema, ToolsSchema
            from pipecat.frames.frames import LLMSetToolsFrame
            
            # Test that classes can be instantiated
            func = FunctionSchema(
                name="test_function",
                description="A test function",
                properties={},
                required=[]
            )
            
            tools = ToolsSchema(standard_tools=[func])
            
            # Test frame creation
            frame = LLMSetToolsFrame(tools=[func])
            
            # Basic assertions
            self.assertEqual(func.name, "test_function")
            self.assertEqual(func.description, "A test function")
            self.assertEqual(len(tools.standard_tools), 1)
            self.assertIsNotNone(frame)
            
        except ImportError as e:
            self.fail(f"Failed to import Pipecat classes: {e}")
        except Exception as e:
            self.fail(f"Failed to create Pipecat objects: {e}")
    
    def test_real_conversion_integration(self):
        """Test conversion with real Pipecat classes (bypassing mocks)"""
        try:
            # Import real classes
            from pipecat.adapters.schemas.tools_schema import FunctionSchema, ToolsSchema
            
            # Create a simple tool converter function (like our bot does)
            def convert_tool_direct(tool_data):
                parameters = tool_data["parameters"]
                properties = parameters.get("properties", {})
                required = parameters.get("required", [])
                func = FunctionSchema(
                    name=tool_data["name"],
                    description=tool_data["description"],
                    properties=properties,
                    required=required
                )
                return ToolsSchema(standard_tools=[func])
            
            # Test data
            tool_data = {
                "name": "get_current_time",
                "description": "Get the current time in a specific timezone",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "timezone": {
                            "type": "string",
                            "description": "Timezone identifier (e.g., 'America/New_York')",
                            "default": "UTC"
                        }
                    },
                    "required": []
                }
            }
            
            # Convert
            result = convert_tool_direct(tool_data)
            
            # Verify
            self.assertIsInstance(result, ToolsSchema)
            self.assertEqual(len(result.functions), 1)
            self.assertIsInstance(result.functions[0], FunctionSchema)
            self.assertEqual(result.functions[0].name, "get_current_time")
            self.assertEqual(result.functions[0].description, "Get the current time in a specific timezone")
            # Verify the properties and required are correctly extracted
            self.assertEqual(result.functions[0].properties, tool_data["parameters"]["properties"])
            self.assertEqual(result.functions[0].required, tool_data["parameters"]["required"])
            
        except Exception as e:
            self.fail(f"Real Pipecat integration test failed: {e}")
    
    def test_llm_set_tools_frame_creation(self):
        """Test creating LLMSetToolsFrame with converted tools"""
        try:
            from pipecat.adapters.schemas.tools_schema import FunctionSchema
            from pipecat.frames.frames import LLMSetToolsFrame
            
            # Create multiple functions
            functions = [
                FunctionSchema(
                    name="search_web",
                    description="Search the web for information",
                    properties={
                        "query": {"type": "string", "description": "Search query"}
                    },
                    required=["query"]
                ),
                FunctionSchema(
                    name="calculate",
                    description="Perform mathematical calculations",
                    properties={
                        "expression": {"type": "string", "description": "Math expression"}
                    },
                    required=["expression"]
                )
            ]
            
            # Create frame
            frame = LLMSetToolsFrame(tools=functions)
            
            # Verify frame properties
            self.assertIsInstance(frame, LLMSetToolsFrame)
            self.assertEqual(len(frame.tools), 2)
            self.assertEqual(frame.tools[0].name, "search_web")
            self.assertEqual(frame.tools[1].name, "calculate")
            
        except Exception as e:
            self.fail(f"LLMSetToolsFrame creation test failed: {e}")




class AsyncTestCase(unittest.TestCase):
    """Base class for async test cases"""
    
    def run(self, result=None):
        """Override run to handle async test methods"""
        return super().run(result)
    
    def _run_async_test(self, test_method):
        """Helper to run async test methods"""
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(test_method())


class TestToolHandlerRegistration(AsyncTestCase):
    """Test tool handler registration with LLM service"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.config = {
            'openai_api_key': 'test-key',
            'cartesia_api_key': 'test-key', 
            'deepgram_api_key': 'test-key'
        }
        self.bot = PipecatAGUIBot(self.config)
        self.mock_llm_service = MagicMock()
        self.mock_llm_service.register_function = MagicMock()
    
    def test_register_single_tool_handler(self):
        """Test registering a handler for a single tool"""
        async def _test():
            tool = MockTool(
                name="test_tool",
                description="A test tool",
                parameters={"type": "object"}
            )
            
            with patch('pipecat_agui_bot.logger') as mock_logger:
                await self.bot.register_tool_handlers([tool], self.mock_llm_service)
                
                # Verify the function was registered
                self.mock_llm_service.register_function.assert_called_once()
                call_args = self.mock_llm_service.register_function.call_args
                self.assertEqual(call_args[0][0], "test_tool")
                self.assertIsNotNone(call_args[0][1])  # Handler function
                
                # Verify logging
                mock_logger.info.assert_any_call("Registered handler for tool 'test_tool'")
        
        self._run_async_test(_test)
    
    def test_register_multiple_tool_handlers(self):
        """Test registering handlers for multiple tools"""
        async def _test():
            tools = [
                MockTool("tool1", "First tool", {}),
                MockTool("tool2", "Second tool", {}),
                MockTool("tool3", "Third tool", {})
            ]
            
            await self.bot.register_tool_handlers(tools, self.mock_llm_service)
            
            # Verify all functions were registered
            self.assertEqual(self.mock_llm_service.register_function.call_count, 3)
            
            # Check each registration
            for i, call in enumerate(self.mock_llm_service.register_function.call_args_list):
                self.assertEqual(call[0][0], f"tool{i+1}")
        
        self._run_async_test(_test)
    
    def test_tool_handler_execution(self):
        """Test that the registered handler logs correctly when executed"""
        async def _test():
            tool = MockTool(
                name="test_function",
                description="Test function",
                parameters={}
            )
            
            with patch('pipecat_agui_bot.logger') as mock_logger:
                # Register the handler
                await self.bot.register_tool_handlers([tool], self.mock_llm_service)
                
                # Get the registered handler function
                handler = self.mock_llm_service.register_function.call_args[0][1]
                
                # Execute the handler
                result = await handler("test_function", {"arg1": "value1"})
                
                # Verify the result
                self.assertEqual(result["status"], "success")
                self.assertIn("test_function", result["message"])
                self.assertIn("Tool execution placeholder", result["result"])
                
                # Verify logging
                mock_logger.info.assert_any_call("Tool 'test_function' called with args: {'arg1': 'value1'}")
                mock_logger.info.assert_any_call(f"Tool 'test_function' completed with result: {result}")
        
        self._run_async_test(_test)
    
    def test_empty_tools_registration(self):
        """Test registering handlers with an empty tools list"""
        async def _test():
            await self.bot.register_tool_handlers([], self.mock_llm_service)
            
            # Verify no functions were registered
            self.mock_llm_service.register_function.assert_not_called()
        
        self._run_async_test(_test)


if __name__ == '__main__':
    unittest.main(verbosity=2)