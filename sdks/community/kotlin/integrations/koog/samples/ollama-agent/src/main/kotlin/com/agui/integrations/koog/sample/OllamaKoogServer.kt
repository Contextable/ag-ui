package com.agui.integrations.koog.sample

import com.agui.core.types.Message
import com.agui.core.types.SystemMessage
import com.agui.core.types.UserMessage
import com.agui.server.aguiStreamingAgent
import com.agui.integrations.koog.agent.KoogAguiAgent
import com.agui.integrations.koog.agent.KoogAgentContext
import com.agui.integrations.koog.agent.KoogAgentRunner
import com.agui.integrations.koog.stream.KoogStreamFrame
import com.agui.integrations.koog.stream.KoogStreamTranslator
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation as ServerContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    val baseUrl = System.getenv("MODEL_RUNNER_BASE_URL") ?: "http://ollama:11434/v1"
    val model = System.getenv("MODEL_RUNNER_CHAT_MODEL") ?: "llama3"
    val systemPrompt = System.getenv("SYSTEM_PROMPT")

    val httpClient = HttpClient(CIO) {
        expectSuccess = false
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }

    Runtime.getRuntime().addShutdownHook(Thread { httpClient.close() })

    val translator = KoogStreamTranslator { System.currentTimeMillis() }
    val runner = OllamaKoogRunner(httpClient, baseUrl, model, systemPrompt)
    val agent = KoogAguiAgent(runner, translator)

    embeddedServer(CIO, port = port, host = "0.0.0.0") {
        install(ServerContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
        routing {
            get("/health") {
                call.respond(mapOf("status" to "ok"))
            }
            aguiStreamingAgent(path = "/agent/run") { input ->
                agent.run(input)
            }
        }
    }.start(wait = true)
}

private class OllamaKoogRunner(
    private val httpClient: HttpClient,
    private val baseUrl: String,
    private val model: String,
    private val systemPrompt: String?
) : KoogAgentRunner {
    private val logger = LoggerFactory.getLogger(OllamaKoogRunner::class.java)

    override fun stream(context: KoogAgentContext): Flow<KoogStreamFrame> = flow {
        val payload = buildRequest(context.input.messages)
        val response = httpClient.post("$baseUrl/chat/completions") {
            contentType(ContentType.Application.Json)
            setBody(payload)
        }

        val body: ChatCompletionResponse = response.ensureSuccess().body()
        val text = body.choices.firstOrNull()?.message?.content ?: ""
        val messageId = "assistant-${context.input.runId}"

        emit(
            KoogStreamFrame.Append(
                messageId = messageId,
                delta = text
            )
        )
        emit(KoogStreamFrame.End())
    }

    private suspend fun HttpResponse.ensureSuccess(): HttpResponse {
        if (!status.isSuccess()) {
            val errorBody = bodyAsText()
            logger.error("Ollama request failed: {}", errorBody)
            throw IllegalStateException("Ollama responded with status ${'$'}{status.value}")
        }
        return this
    }

    private fun buildRequest(messages: List<Message>): ChatCompletionRequest {
        val merged = mutableListOf<ChatMessage>()
        systemPrompt?.takeIf { it.isNotBlank() }?.let {
            merged += ChatMessage(role = "system", content = it)
        }
        merged += messages.mapNotNull { it.toChatMessage() }
        return ChatCompletionRequest(
            model = model,
            messages = merged,
            stream = false
        )
    }
}

private fun Message.toChatMessage(): ChatMessage? = when (this) {
    is SystemMessage -> ChatMessage(role = "system", content = content)
    is UserMessage -> ChatMessage(role = "user", content = content)
    else -> null
}

@Serializable
private data class ChatCompletionRequest(
    val model: String,
    val messages: List<ChatMessage>,
    val stream: Boolean = false
)

@Serializable
private data class ChatMessage(
    val role: String,
    val content: String
)

@Serializable
private data class ChatCompletionResponse(
    val choices: List<ChatChoice>
)

@Serializable
private data class ChatChoice(
    val index: Int,
    val message: ChoiceMessage
)

@Serializable
private data class ChoiceMessage(
    val role: String,
    val content: String,
    val refusal: String? = null
)
