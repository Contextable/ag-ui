package com.agui.samples.koog.ollama

import co.touchlab.kermit.Logger
import com.agui.core.types.AgUiJson
import com.agui.core.types.Message
import com.agui.core.types.Role
import com.agui.core.types.RunAgentInput
import com.agui.integrations.koog.KoogAguiAgent
import com.agui.integrations.koog.KoogAgent
import com.agui.integrations.koog.KoogAgentInput
import com.agui.integrations.koog.KoogStreamFrame
import com.agui.integrations.koog.koogToolRegistry
import com.agui.server.aguiSseAgent
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.server.application.ApplicationStopped
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.cio.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation as ServerContentNegotiation
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private val logger = Logger.withTag("KoogOllamaSample")

fun main() {
    val port = System.getenv("SERVER_PORT")?.toIntOrNull() ?: 8080
    val ollamaBaseUrl = System.getenv("MODEL_RUNNER_BASE_URL") ?: "http://ollama:11434/v1"
    val modelId = System.getenv("MODEL_RUNNER_CHAT_MODEL") ?: "llama3"
    val systemPrompt = System.getenv("SYSTEM_PROMPT")

    val httpClient = HttpClient(CIO) {
        install(ContentNegotiation) { json(json = AgUiJson) }
    }

    val koogAgent = OllamaKoogAgent(
        httpClient = httpClient,
        endpoint = ollamaBaseUrl,
        model = modelId,
        systemPrompt = systemPrompt
    )

    val aguiAgent = KoogAguiAgent(
        agent = koogAgent,
        translator = com.agui.integrations.koog.KoogStreamTranslator(),
        toolRegistry = koogToolRegistry { }
    )

    embeddedServer(CIO, port = port) {
        configureHttp(aguiAgent)
        environment.monitor.subscribe(ApplicationStopped) {
            logger.i { "Shutting down Koog Ollama sample" }
            httpClient.close()
        }
    }.start(wait = true)
}

private fun Application.configureHttp(agent: KoogAguiAgent) {
    install(ServerContentNegotiation) { json(json = AgUiJson) }

    routing {
        get("/health") {
            call.respondText("ok")
        }

        aguiSseAgent(path = "/agent/stream", json = AgUiJson) { input: RunAgentInput ->
            agent.stream(input)
        }
    }
}

private class OllamaKoogAgent(
    private val httpClient: HttpClient,
    private val endpoint: String,
    private val model: String,
    private val systemPrompt: String?
) : KoogAgent {
    override fun run(input: KoogAgentInput): Flow<KoogStreamFrame> = flow {
        emit(KoogStreamFrame.SessionStarted(threadId = input.threadId, runId = input.runId))
        val openAiMessages = buildOpenAiMessages(systemPrompt, input.messages)
        val request = ChatCompletionRequest(
            model = model,
            messages = openAiMessages,
            stream = false
        )

        try {
            val response = httpClient.post("$endpoint/chat/completions") {
                contentType(ContentType.Application.Json)
                setBody(request)
            }

            val body = Json.decodeFromString(ChatCompletionResponse.serializer(), response.bodyAsText())
            val content = body.choices.firstOrNull()?.message?.content.orEmpty()
            val messageId = "assistant-${input.runId}"
            emit(KoogStreamFrame.MessageStarted(messageId))
            content.chunked(120).forEach { chunk ->
                if (chunk.isNotEmpty()) {
                    emit(KoogStreamFrame.MessageDelta(messageId, chunk))
                }
            }
            emit(KoogStreamFrame.MessageFinished(messageId))
            emit(KoogStreamFrame.SessionFinished())
        } catch (error: Throwable) {
            logger.e(error) { "Failed to obtain completion from Ollama" }
            emit(
                KoogStreamFrame.SessionError(
                    message = error.message ?: "Ollama request failed",
                    code = "OLLAMA_ERROR"
                )
            )
        }
    }
}

private fun buildOpenAiMessages(systemPrompt: String?, messages: List<Message>): List<OpenAIMessage> {
    val result = mutableListOf<OpenAIMessage>()
    systemPrompt?.let { result += OpenAIMessage(role = "system", content = it) }
    messages.forEach { message ->
        when (message.messageRole) {
            Role.SYSTEM -> result += OpenAIMessage("system", message.content ?: "")
            Role.USER -> result += OpenAIMessage("user", message.content ?: "")
            Role.ASSISTANT -> result += OpenAIMessage("assistant", message.content ?: "")
            Role.DEVELOPER -> result += OpenAIMessage("system", message.content ?: "")
            Role.TOOL -> result += OpenAIMessage("tool", message.content ?: "")
        }
    }
    return result
}

@Serializable
private data class ChatCompletionRequest(
    val model: String,
    val messages: List<OpenAIMessage>,
    val stream: Boolean = false
)

@Serializable
private data class ChatCompletionResponse(
    val choices: List<ChatCompletionChoice> = emptyList()
)

@Serializable
private data class ChatCompletionChoice(
    val index: Int,
    val message: OpenAIMessage = OpenAIMessage(role = "assistant", content = ""),
    @SerialName("finish_reason")
    val finishReason: String? = null
)

@Serializable
private data class OpenAIMessage(
    val role: String,
    val content: String
)
