package com.agui.samples.koog.ollama

import ai.koog.agents.core.agent.AIAgent
import ai.koog.agents.core.agent.FunctionalAIAgent
import ai.koog.agents.core.agent.config.AIAgentConfig
import ai.koog.agents.core.agent.asAssistantMessageOrNull
import ai.koog.agents.core.agent.functionalStrategy
import ai.koog.agents.core.agent.requestLLM
import ai.koog.agents.core.tools.ToolRegistry
import ai.koog.agents.features.eventHandler.feature.EventHandler
import ai.koog.agents.features.eventHandler.feature.EventHandlerConfig
import ai.koog.prompt.dsl.prompt
import ai.koog.prompt.executor.clients.openai.OpenAIClientSettings
import ai.koog.prompt.executor.clients.openai.OpenAILLMClient
import ai.koog.prompt.executor.llms.SingleLLMPromptExecutor
import ai.koog.prompt.llm.LLMCapability
import ai.koog.prompt.llm.LLMProvider
import ai.koog.prompt.llm.LLModel
import co.touchlab.kermit.Logger
import com.agui.core.types.AgUiJson
import com.agui.core.types.AssistantMessage
import com.agui.core.types.DeveloperMessage
import com.agui.core.types.Message
import com.agui.core.types.Role
import com.agui.core.types.RunAgentInput
import com.agui.core.types.SystemMessage
import com.agui.core.types.ToolMessage
import com.agui.core.types.UserMessage
import com.agui.koog.KoogAguiAgent
import com.agui.koog.KoogAgent
import com.agui.koog.KoogAgentInput
import com.agui.koog.KoogStreamFrame
import com.agui.koog.KoogStreamTranslator
import com.agui.koog.KoogToolRegistry
import com.agui.server.aguiSseAgent
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO as ClientCIO
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.application.install
import io.ktor.server.cio.CIO as ServerCIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation as ServerContentNegotiation
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

private val logger = Logger.withTag("KoogOllamaSample")

fun main() {
    val port = System.getenv("SERVER_PORT")?.toIntOrNull() ?: 8080
    val rawBaseUrl = System.getenv("MODEL_RUNNER_BASE_URL") ?: "http://ollama:11434/v1"
    val chatPathOverride = System.getenv("MODEL_RUNNER_CHAT_PATH")
    val modelId = System.getenv("MODEL_RUNNER_CHAT_MODEL") ?: "llama3"
    val systemPrompt = System.getenv("SYSTEM_PROMPT")
    val apiKey = System.getenv("MODEL_RUNNER_API_KEY") ?: System.getenv("OPENAI_API_KEY") ?: "ollama"

    val httpClient = HttpClient(ClientCIO)
    val openAiSettings = resolveOpenAiSettings(rawBaseUrl, chatPathOverride)
    val openAiClient = OpenAILLMClient(
        apiKey = apiKey,
        settings = openAiSettings,
        baseClient = httpClient
    )
    val llModel = resolveKoogCatalogModel(modelId)
        ?: buildFallbackModel(modelId).also {
            logger.w { "Falling back to manual LLModel for '$modelId'" }
        }

    val aguiAgent = KoogAguiAgent(
        agent = FunctionalKoogAgent(openAiClient, llModel, systemPrompt),
        translator = KoogStreamTranslator(),
        toolRegistry = KoogToolRegistry.empty()
    )

    embeddedServer(ServerCIO, port = port) {
        configureHttp(aguiAgent, httpClient)
    }.start(wait = true)
}

private fun Application.configureHttp(agent: KoogAguiAgent, httpClient: HttpClient) {
    install(ServerContentNegotiation) { json(json = AgUiJson) }

    routing {
        get("/health") {
            call.respondText("ok")
        }

        aguiSseAgent(path = "/agent/stream", json = AgUiJson) { input: RunAgentInput ->
            agent.stream(input)
        }
    }

    environment.monitor.subscribe(ApplicationStopped) {
        logger.i { "Shutting down Koog Ollama sample" }
        httpClient.close()
    }
}

private class FunctionalKoogAgent(
    private val client: OpenAILLMClient,
    private val model: LLModel,
    private val systemPrompt: String?
) : KoogAgent {

    private val promptExecutor = SingleLLMPromptExecutor(client)

    override fun run(input: KoogAgentInput): Flow<KoogStreamFrame> = callbackFlow {
        val now = System.currentTimeMillis()
        trySend(
            KoogStreamFrame.SessionStarted(
                threadId = input.threadId,
                runId = input.runId,
                timestamp = now
            )
        )

        val prepared = prepareAgentConfig(input, systemPrompt, model)
        val messageId = "assistant-${input.runId}"
        var sessionClosed = false

        // NOTE: Koog tracing via Tracing.Feature is only available once 0.5.1 lands on Maven.
        // Until then, we rely on EventHandler callbacks for minimal diagnostics.
        val agent: FunctionalAIAgent<KoogAgentInput, Unit> = AIAgent(
            promptExecutor = promptExecutor,
            agentConfig = prepared.config,
            strategy = functionalStrategy("koog-ollama-functional") { agentInput ->
                val userMessage = prepared.latestUserMessage ?: ""
                val response = requestLLM(userMessage)
                logger.i { "Assistant message: ${response.asAssistantMessageOrNull()?.content}" }
                val assistant = response.asAssistantMessageOrNull()
                val content = assistant?.content.orEmpty()
                if (content.isNotEmpty()) {
                    trySend(KoogStreamFrame.MessageStarted(messageId = messageId))
                    trySend(
                        KoogStreamFrame.MessageDelta(
                            messageId = messageId,
                            delta = content
                        )
                    )
                    trySend(KoogStreamFrame.MessageFinished(messageId = messageId))
                }
                trySend(
                    KoogStreamFrame.SessionFinished(
                        timestamp = System.currentTimeMillis()
                    )
                )
                sessionClosed = true
                Unit
            },
            toolRegistry = ToolRegistry.EMPTY,
            installFeatures = {
                install(EventHandler) {
                    onAgentStarting { ctx ->
                        logger.i { "Koog agent ${ctx.agent.id} starting run ${ctx.runId}" }
                    }
                    onLLMCallStarting { ctx ->
                        logger.i { "LLM call starting: model=${ctx.model.id} promptSize=${ctx.prompt.messages.size}" }
                    }
                    // 0.5.0 does not expose detailed contexts for completed streams.
                    // Keep inputs minimal and log only initial/failure events for now.
                    onAgentCompleted { ctx ->
                        logger.i { "Koog agent ${ctx.agentId} completed run ${ctx.runId}" }
                    }
                    onLLMStreamingFailed { event ->
                        logger.e(event.error) { "LLM streaming failed run ${event.runId}" }
                        trySend(
                            KoogStreamFrame.SessionError(
                                message = event.error.message ?: "LLM streaming failure",
                                code = "KOOG_OPENAI_ERROR"
                            )
                        )
                    }
                }
            }
        )

        val agentJob = launch {
            try {
                agent.run(input)
            } catch (error: Throwable) {
                logger.e(error) { "Functional Koog agent execution failed" }
                trySend(
                    KoogStreamFrame.SessionError(
                        message = error.message ?: "Koog agent execution failed",
                        code = "KOOG_AGENT_ERROR"
                    )
                )
                if (!sessionClosed) {
                    trySend(KoogStreamFrame.SessionFinished(timestamp = System.currentTimeMillis()))
                    sessionClosed = true
                }
            } finally {
                if (!sessionClosed) {
                    trySend(KoogStreamFrame.SessionFinished(timestamp = System.currentTimeMillis()))
                }
                agent.close()
                close()
            }
        }

        awaitClose {
            agentJob.cancel()
        }
    }
}

private data class PreparedConfig(
    val config: AIAgentConfig,
    val latestUserMessage: String?
)

private fun prepareAgentConfig(
    input: KoogAgentInput,
    systemPrompt: String?,
    model: LLModel
): PreparedConfig {
    val history = input.messages
    val latestUser = history.lastOrNull { it.messageRole == Role.USER }
    val historyWithoutLatest = if (latestUser != null) history.dropLast(1) else history

    val prompt = prompt("${input.threadId}-${input.runId}") {
        systemPrompt?.takeIf { it.isNotBlank() }?.let { system(it) }
        historyWithoutLatest.forEach { message ->
            appendAguiMessage(message)
        }
    }

    return PreparedConfig(
        config = AIAgentConfig(
            prompt = prompt,
            model = model,
            maxAgentIterations = 1
        ),
        latestUserMessage = latestUser?.content
    )
}

private fun ai.koog.prompt.dsl.PromptBuilder.appendAguiMessage(message: Message) {
    when (message) {
        is DeveloperMessage -> system(message.content)
        is SystemMessage -> message.content?.let { system(it) }
        is UserMessage -> user(message.content)
        is AssistantMessage -> {
            message.content?.let { assistant(it) }
            message.toolCalls.orEmpty().forEach { toolCall ->
                tool {
                    call(toolCall.id, toolCall.function.name, toolCall.function.arguments)
                }
            }
        }
        is ToolMessage -> tool {
            result(message.toolCallId, message.name ?: message.toolCallId, message.content)
        }
        else -> {}
    }
}

private fun resolveOpenAiSettings(baseUrl: String, chatPathOverride: String?): OpenAIClientSettings {
    val trimmed = baseUrl.trim().removeSuffix("/")
    val base = if (trimmed.endsWith("/v1")) trimmed.removeSuffix("/v1") else trimmed
    val normalizedBase = if (base.isBlank()) "http://ollama:11434" else base
    val chatPathPrefix = if (trimmed.endsWith("/v1")) "v1" else "v1"
    val chatPath = chatPathOverride
        ?.takeIf { it.isNotBlank() }
        ?.trim()
        ?.trimStart('/')
        ?: "$chatPathPrefix/chat/completions"

    return OpenAIClientSettings(
        baseUrl = normalizedBase,
        chatCompletionsPath = chatPath
    )
}

private fun resolveKoogCatalogModel(modelId: String): LLModel? {
    val trimmed = modelId.trim().removePrefix("ollama://").removePrefix("ollama/")
    if (trimmed.isEmpty()) return null

    val candidates = linkedSetOf<String>().apply {
        add(trimmed)
        add("ollama.$trimmed")
        listOf("meta", "alibaba", "groq", "granite").forEach { maker ->
            add("ollama.$maker.$trimmed")
        }
    }

    return candidates.asSequence()
        .mapNotNull { candidate -> tryModelFromIdentifier(candidate) }
        .firstOrNull()
}

private fun buildFallbackModel(modelId: String): LLModel = LLModel(
    provider = LLMProvider.OpenAI,
    id = modelId,
    capabilities = listOf(
        LLMCapability.Completion,
        LLMCapability.OpenAIEndpoint.Completions
    ),
    contextLength = 128_000
)

@Suppress("TooGenericExceptionCaught")
private fun tryModelFromIdentifier(identifier: String): LLModel? {
    return runCatching {
        val parserClass = Class.forName("ai.koog.ktor.utils.LLMModelParserKt")
        val method = parserClass.getDeclaredMethod("getModelFromIdentifier", String::class.java)
        method.isAccessible = true
        method.invoke(null, identifier) as? LLModel
    }.getOrNull()
}
