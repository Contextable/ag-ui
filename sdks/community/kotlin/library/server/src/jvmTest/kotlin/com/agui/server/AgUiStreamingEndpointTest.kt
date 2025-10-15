package com.agui.server

import com.agui.client.agent.HttpAgent
import com.agui.client.agent.HttpAgentConfig
import com.agui.core.types.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.routing.*
import io.ktor.server.testing.*
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AgUiStreamingEndpointTest {
    @Test
    fun `streams events to HttpAgent`() = runTest {
        testApplication {
            application {
                install(io.ktor.server.plugins.contentnegotiation.ContentNegotiation) {
                    json(AgUiJson)
                }
                routing {
                    aguiStreamingAgent(path = "/agent") { input ->
                        flow {
                            emit(RunStartedEvent(threadId = input.threadId, runId = input.runId))
                            val messageId = "msg-1"
                            emit(TextMessageStartEvent(messageId = messageId))
                            emit(TextMessageContentEvent(messageId = messageId, delta = "Hello"))
                            emit(TextMessageEndEvent(messageId = messageId))
                            emit(RunFinishedEvent(threadId = input.threadId, runId = input.runId))
                        }
                    }
                }
            }

            val client = createClient {
                install(io.ktor.client.plugins.contentnegotiation.ContentNegotiation) {
                    json(AgUiJson)
                }
            }

            val endpointUrl = "http://localhost/agent"
            val httpAgent = HttpAgent(
                config = HttpAgentConfig(
                    url = endpointUrl,
                    threadId = "thread-123",
                    initialState = JsonObject(emptyMap()),
                    initialMessages = emptyList(),
                    debug = false,
                    headers = emptyMap()
                ),
                httpClient = client
            )

            val events = httpAgent
                .runAgentObservable(
                    RunAgentInput(
                        threadId = "thread-123",
                        runId = "run-1"
                    )
                )
                .toList()

            assertEquals(5, events.size)
            assertTrue(events[0] is RunStartedEvent)
            assertTrue(events[1] is TextMessageStartEvent)
            assertTrue(events[2] is TextMessageContentEvent)
            assertEquals("Hello", (events[2] as TextMessageContentEvent).delta)
            assertTrue(events[3] is TextMessageEndEvent)
            assertTrue(events[4] is RunFinishedEvent)

            httpAgent.dispose()
        }
    }

    @Test
    fun `responds with NDJSON payload and content type`() = runTest {
        testApplication {
            application {
                install(io.ktor.server.plugins.contentnegotiation.ContentNegotiation) {
                    json(AgUiJson)
                }
                routing {
                    aguiStreamingAgent(path = "/agent") { input ->
                        flowOf(
                            RunStartedEvent(threadId = input.threadId, runId = input.runId),
                            RunFinishedEvent(threadId = input.threadId, runId = input.runId)
                        )
                    }
                }
            }

            val response = client.post("/agent") {
                contentType(ContentType.Application.Json)
                setBody(
                    AgUiJson.encodeToString(
                        RunAgentInput(
                            threadId = "thread-json",
                            runId = "run-json"
                        )
                    )
                )
            }

            val rawContentType = response.headers[HttpHeaders.ContentType]
            assertTrue(rawContentType == null || rawContentType.startsWith(ContentType.Application.Json.toString()))

            val payload = response.bodyAsText()
            val frames = payload
                .lineSequence()
                .filter { it.isNotBlank() }
                .toList()
            assertEquals(2, frames.size)

            val expectedStart =
                AgUiJson.encodeToString(
                    BaseEvent.serializer(),
                    RunStartedEvent(threadId = "thread-json", runId = "run-json")
                )
            val expectedEnd =
                AgUiJson.encodeToString(
                    BaseEvent.serializer(),
                    RunFinishedEvent(threadId = "thread-json", runId = "run-json")
                )

            assertEquals(listOf(expectedStart, expectedEnd), frames)
            assertEquals("chunked", response.headers[HttpHeaders.TransferEncoding])
        }
    }

    @Test
    fun `propagates default error message when throwable has none`() = runTest {
        testApplication {
            application {
                install(io.ktor.server.plugins.contentnegotiation.ContentNegotiation) {
                    json(AgUiJson)
                }
                routing {
                    aguiStreamingAgent(path = "/agent") {
                        throw IllegalStateException()
                    }
                }
            }

            val client = createClient {
                install(io.ktor.client.plugins.contentnegotiation.ContentNegotiation) {
                    json(AgUiJson)
                }
            }

            val httpAgent = HttpAgent(
                config = HttpAgentConfig(
                    url = "http://localhost/agent",
                    threadId = "thread-default-error",
                    initialState = JsonObject(emptyMap()),
                    initialMessages = emptyList(),
                    debug = false,
                    headers = emptyMap()
                ),
                httpClient = client
            )

            val events = httpAgent
                .runAgentObservable(
                    RunAgentInput(
                        threadId = "thread-default-error",
                        runId = "run-default-error"
                    )
                )
                .toList()

            val errorEvent = events.single() as RunErrorEvent
            assertEquals("SERVER_ERROR", errorEvent.code)
            assertEquals("Unhandled server error", errorEvent.message)

            httpAgent.dispose()
        }
    }

    @Test
    fun `emits run error when handler throws`() = runTest {
        testApplication {
            application {
                install(io.ktor.server.plugins.contentnegotiation.ContentNegotiation) {
                    json(AgUiJson)
                }
                routing {
                    aguiStreamingAgent(path = "/agent") {
                        throw IllegalStateException("boom")
                    }
                }
            }

            val client = createClient {
                install(io.ktor.client.plugins.contentnegotiation.ContentNegotiation) {
                    json(AgUiJson)
                }
            }

            val endpointUrl = "http://localhost/agent"
            val httpAgent = HttpAgent(
                config = HttpAgentConfig(
                    url = endpointUrl,
                    threadId = "thread-err",
                    initialState = JsonObject(emptyMap()),
                    initialMessages = emptyList(),
                    debug = false,
                    headers = emptyMap()
                ),
                httpClient = client
            )

            val events = httpAgent
                .runAgentObservable(
                    RunAgentInput(
                        threadId = "thread-err",
                        runId = "run-err"
                    )
                )
                .toList()

            assertEquals(1, events.size)
            val errorEvent = events.single()
            assertTrue(errorEvent is RunErrorEvent)
            assertEquals("SERVER_ERROR", errorEvent.code)

            httpAgent.dispose()
        }
    }
}
