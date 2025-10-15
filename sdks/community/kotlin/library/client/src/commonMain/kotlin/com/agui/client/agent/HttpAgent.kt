package com.agui.client.agent

import co.touchlab.kermit.Logger
import com.agui.client.transport.NdjsonEventParser
import com.agui.core.types.*
import io.ktor.client.*
import io.ktor.client.plugins.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.cancel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow

private val logger = Logger.withTag("HttpAgent")

/**
 * HTTP-based agent implementation using Ktor client.
 * Extends [AbstractAgent] to provide newline-delimited JSON streaming
 * compatible with the CopilotKit/AG-UI protocol.
 */
class HttpAgent(
    private val config: HttpAgentConfig,
    private val httpClient: HttpClient? = null
) : AbstractAgent(config) {
    
    private val client: HttpClient
    private val parser = NdjsonEventParser()
    
    init {
        client = httpClient ?: createPlatformHttpClient(config.requestTimeout, config.connectTimeout)
    }
    
    override fun run(input: RunAgentInput): Flow<BaseEvent> = channelFlow {
        try {
            val response = client.post(config.url) {
                method = HttpMethod.Post
                config.headers.forEach { (key, value) ->
                    header(key, value)
                }
                contentType(ContentType.Application.Json)
                accept(ContentType.Application.Json)
                setBody(input)
            }

            if (!response.status.isSuccess()) {
                val statusMessage = "HTTP ${response.status.value} ${response.status.description}"
                val errorBody = runCatching { response.bodyAsText() }.getOrNull()
                val message = when {
                    errorBody.isNullOrBlank() -> statusMessage
                    else -> "$statusMessage: $errorBody"
                }
                send(
                    RunErrorEvent(
                        message = message,
                        code = "TRANSPORT_ERROR"
                    )
                )
                return@channelFlow
            }

            val channel: ByteReadChannel = response.bodyAsChannel()
            try {
                parser.parse(channel) { event ->
                    logger.d { "Parsed event: ${event.eventType}" }
                    send(event)
                }
            } finally {
                channel.cancel()
            }
        } catch (e: CancellationException) {
            logger.d { "Agent run cancelled" }
            throw e
        } catch (e: HttpRequestTimeoutException) {
            logger.e(e) { "Agent run timed out" }
            send(
                RunErrorEvent(
                    message = e.message ?: "Request timed out",
                    code = "TIMEOUT_ERROR"
                )
            )
        } catch (e: Exception) {
            logger.e(e) { "Agent run failed: ${e.message}" }
            send(
                RunErrorEvent(
                    message = e.message ?: "Unknown error",
                    code = "TRANSPORT_ERROR"
                )
            )
        }
    }
    
    /**
     * Creates a clone of this agent with the same configuration.
     * The cloned agent will have the same HTTP configuration and current state,
     * but will maintain its own HTTP client lifecycle.
     * 
     * @return AbstractAgent a new HttpAgent instance with identical configuration
     */
    override fun clone(): AbstractAgent {
        return HttpAgent(
            config = HttpAgentConfig(
                agentId = this@HttpAgent.agentId,
                description = this@HttpAgent.description,
                threadId = this@HttpAgent.threadId,
                initialMessages = this@HttpAgent.messages.toList(),
                initialState = this@HttpAgent.state,
                debug = this@HttpAgent.debug,
                url = config.url,
                headers = config.headers,
                requestTimeout = config.requestTimeout,
                connectTimeout = config.connectTimeout
            ),
            httpClient = httpClient
        )
    }
    
    /**
     * Cleanup HTTP client resources only when explicitly closed, not after each run.
     * The HTTP client is designed to be reusable across multiple agent runs,
     * so this method does not close the client.
     */
    override fun onFinalize() {
        super.onFinalize()
        // Don't close the client here - it should be reusable for multiple runs
    }
    
    /**
     * Override dispose to properly cleanup HTTP client resources.
     * Closes the HTTP client if it was created internally (not provided externally).
     * This ensures proper cleanup of network resources and connection pools.
     */
    override fun dispose() {
        // Close the HTTP client if we created it
        if (httpClient == null) {
            client.close()
        }
        super.dispose()
    }
}