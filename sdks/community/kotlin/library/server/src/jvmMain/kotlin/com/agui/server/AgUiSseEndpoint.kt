package com.agui.server

import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import com.agui.core.types.RunErrorEvent
import co.touchlab.kermit.Logger
import io.ktor.http.ContentType
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.json.Json

private val logger = Logger.withTag("AgUiSseEndpoint")

/**
 * Installs an AG-UI compliant SSE endpoint on the provided [Route].
 *
 * The endpoint accepts a `RunAgentInput` payload via POST and streams AG-UI
 * events back to the caller using Server-Sent Events. Any exception thrown while
 * producing events is surfaced to the client as a `RUN_ERROR` event so clients
 * receive structured failure information.
 *
 * @param path Endpoint path relative to the current route (default: "/")
 * @param json JSON serializer used to encode events (defaults to [AgUiJson])
 * @param agentRunner Callback that produces a flow of AG-UI events for the
 * provided [RunAgentInput].
 */
fun Route.aguiSseAgent(
    path: String = "/",
    json: Json = AgUiJson,
    agentRunner: suspend ApplicationCall.(RunAgentInput) -> Flow<BaseEvent>
) {
    post(path) {
        val input = call.receive<RunAgentInput>()
        val encoder = SseEventEncoder(json)

        call.respondTextWriter(contentType = ContentType.Text.EventStream) {
            try {
                agentRunner(call, input).collect { event ->
                    val payload = encoder.encode(event)
                    write("data: $payload\n\n")
                    flush()
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Throwable) {
                logger.e(error) { "Agent handler failed" }
                val errorEvent = RunErrorEvent(
                    message = error.message ?: "Unhandled server error",
                    code = "SERVER_ERROR"
                )
                val payload = encoder.encode(errorEvent)
                write("data: $payload\n\n")
                flush()
            }
        }
    }
}
