#!/usr/bin/env python
"""Test app name extraction functionality."""

import asyncio
from ag_ui.core import RunAgentInput, UserMessage, Context
from ag_ui_adk import ADKAgent, add_adk_fastapi_endpoint
from google.adk.agents import Agent

async def test_static_app_name():
    """Test static app name configuration."""
    print("🧪 Testing static app name...")

    # Create a test ADK agent
    test_agent = Agent(name="test_agent", instruction="You are a test agent.")

    # Create agent with static app name
    adk_agent = ADKAgent(
        adk_agent=test_agent,
        app_name="static_test_app",
        user_id="test_user",
        use_in_memory_services=True
    )

    # Create test input
    test_input = RunAgentInput(
        thread_id="test_thread",
        run_id="test_run",
        messages=[UserMessage(id="1", role="user", content="Test")],
        state={},
        context=[],
        tools=[],
        forwarded_props={}
    )

    # Get app name
    app_name = adk_agent._get_app_name(test_input)
    print(f"   App name: {app_name}")

    if app_name == "static_test_app":
        print("✅ Static app name works correctly")
        return True
    else:
        print("❌ Static app name not working")
        return False

async def test_custom_extractor():
    """Test custom app_name_extractor function."""
    print("\n🧪 Testing custom app_name_extractor...")

    # Create custom extractor
    def extract_app_from_context(input_data):
        for ctx in input_data.context:
            if ctx.description == "app":
                return ctx.value
        return "fallback_app"

    # Create a test ADK agent
    test_agent = Agent(name="test_agent", instruction="You are a test agent.")

    # Create agent with custom extractor
    adk_agent = ADKAgent(
        adk_agent=test_agent,
        app_name_extractor=extract_app_from_context,
        user_id="test_user",
        use_in_memory_services=True
    )

    # Test with context containing app
    test_input_with_app = RunAgentInput(
        thread_id="test_thread",
        run_id="test_run",
        messages=[UserMessage(id="1", role="user", content="Test")],
        state={},
        context=[
            Context(description="app", value="my_custom_app"),
            Context(description="user", value="john_doe")
        ],
        tools=[],
        forwarded_props={}
    )

    app_name = adk_agent._get_app_name(test_input_with_app)
    print(f"   App name from context: {app_name}")

    # Test fallback
    test_input_no_app = RunAgentInput(
        thread_id="test_thread",
        run_id="test_run",
        messages=[UserMessage(id="1", role="user", content="Test")],
        state={},
        context=[Context(description="user", value="john_doe")],
        tools=[],
        forwarded_props={}
    )

    app_name_fallback = adk_agent._get_app_name(test_input_no_app)
    print(f"   App name fallback: {app_name_fallback}")

    if app_name == "my_custom_app" and app_name_fallback == "fallback_app":
        print("✅ Custom app_name_extractor works correctly")
        return True
    else:
        print("❌ Custom app_name_extractor not working")
        return False

async def test_default_extractor():
    """Test default app extraction logic - should use agent name."""
    print("\n🧪 Testing default app extraction...")

    # Create a test ADK agent with a specific name
    test_agent = Agent(name="default_app_agent", instruction="You are a test agent.")

    # Create agent without specifying app_name or extractor
    # This should now use the agent name as app_name
    adk_agent = ADKAgent(
        adk_agent=test_agent,
        user_id="test_user",
        use_in_memory_services=True
    )

    # Create test input
    test_input = RunAgentInput(
        thread_id="test_thread",
        run_id="test_run",
        messages=[UserMessage(id="1", role="user", content="Test")],
        state={},
        context=[],
        tools=[],
        forwarded_props={}
    )

    # Get app name - should use the agent name passed to ADKAgent
    app_name = adk_agent._get_app_name(test_input)
    print(f"   App name from agent: {app_name}")

    # Should be the agent name passed to ADKAgent constructor
    if app_name == "default_app_agent":
        print("✅ Default app extraction using agent name works correctly")
        return True
    else:
        print(f"❌ Expected 'default_app_agent', got '{app_name}'")
        return False

async def test_conflicting_config():
    """Test that specifying both app_name and app_name_extractor raises error."""
    print("\n🧪 Testing conflicting configuration...")

    def dummy_extractor(input_data):
        return "extracted_app"

    # Create a test ADK agent
    test_agent = Agent(name="conflict_test_agent", instruction="You are a test agent.")

    try:
        adk_agent = ADKAgent(
            adk_agent=test_agent,
            app_name="static_app",
            app_name_extractor=dummy_extractor,
            user_id="test_user",
            use_in_memory_services=True
        )
        print("❌ Should have raised ValueError")
        return False
    except ValueError as e:
        print(f"✅ Correctly raised error: {e}")
        return True

async def test_combined_extractors():
    """Test using both app and user extractors together."""
    print("\n🧪 Testing combined app and user extractors...")

    def extract_app(input_data):
        for ctx in input_data.context:
            if ctx.description == "app":
                return ctx.value
        return "AG-UI ADK Agent"

    def extract_user(input_data):
        for ctx in input_data.context:
            if ctx.description == "user":
                return ctx.value
        return "anonymous"

    # Create a test ADK agent
    test_agent = Agent(name="combined_test_agent", instruction="You are a test agent.")

    # Create agent with both extractors
    adk_agent = ADKAgent(
        adk_agent=test_agent,
        app_name_extractor=extract_app,
        user_id_extractor=extract_user,
        use_in_memory_services=True
    )

    # Test with full context
    test_input = RunAgentInput(
        thread_id="test_thread",
        run_id="test_run",
        messages=[UserMessage(id="1", role="user", content="Test")],
        state={},
        context=[
            Context(description="app", value="production_app"),
            Context(description="user", value="alice_smith")
        ],
        tools=[],
        forwarded_props={}
    )

    app_name = adk_agent._get_app_name(test_input)
    user_id = adk_agent._get_user_id(test_input)

    print(f"   App name: {app_name}")
    print(f"   User ID: {user_id}")

    if app_name == "production_app" and user_id == "alice_smith":
        print("✅ Combined extractors work correctly")
        return True
    else:
        print("❌ Combined extractors not working")
        return False

async def test_no_app_config():
    """Test that ADKAgent works without any app configuration."""
    print("\n🧪 Testing no app configuration (should use agent name)...")

    try:
        # This should work now - no app_name or app_name_extractor needed
        adk_agent = ADKAgent(
            user_id="test_user",
            use_in_memory_services=True
        )

        # Create test input
        test_input = RunAgentInput(
            thread_id="test_thread",
            run_id="test_run",
            messages=[UserMessage(id="1", role="user", content="Test")],
            state={},
            context=[],
            tools=[],
            forwarded_props={}
        )

        app_name = adk_agent._get_app_name(test_input)
        print(f"   App name: {app_name}")

        if app_name:  # Should get some valid app name
            print("✅ ADKAgent works without app configuration")
            return True
        else:
            print("❌ No app name returned")
            return False

    except Exception as e:
        print(f"❌ Failed to create ADKAgent without app config: {e}")
        return False

async def main():
    print("🚀 Testing App Name Extraction")
    print("========================================")

    # Set up a mock agent in registry to avoid errors
    agent = Agent(name="test_agent", instruction="Test agent")
    registry = AgentRegistry.get_instance()
    registry.clear()
    registry.set_default_agent(agent)

    tests = [
        ("test_static_app_name", test_static_app_name),
        ("test_custom_extractor", test_custom_extractor),
        ("test_default_extractor", test_default_extractor),
        ("test_conflicting_config", test_conflicting_config),
        ("test_combined_extractors", test_combined_extractors),
        ("test_no_app_config", test_no_app_config)
    ]

    results = []
    for test_name, test_func in tests:
        try:
            result = await test_func()
            results.append(result)
        except Exception as e:
            print(f"❌ Test {test_name} failed with exception: {e}")
            import traceback
            traceback.print_exc()
            results.append(False)

    print("\n========================================")
    print("📊 Test Results:")

    for i, (test_name, result) in enumerate(zip([name for name, _ in tests], results), 1):
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {i}. {test_name}: {status}")

    passed = sum(results)
    total = len(results)

    if passed == total:
        print(f"\n🎉 All {total} tests passed!")
        print("💡 App name extraction functionality is working correctly")
    else:
        print(f"\n⚠️ {passed}/{total} tests passed")

if __name__ == "__main__":
    asyncio.run(main())