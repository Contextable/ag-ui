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
 * Installs an SSE endpoint for legacy experiments.
 *
 * AG-UI uses newline-delimited JSON over HTTP for production transports. New
 * deployments should prefer [aguiStreamingAgent]. This helper remains available
 * for backward compatibility with prototypes built against the original SSE
 * proof-of-concept.
 */
@Deprecated(
    message = "AG-UI uses HTTP streaming with newline-delimited JSON. Use aguiStreamingAgent instead.",
    replaceWith = ReplaceWith("aguiStreamingAgent(path, json, agentRunner)")
)
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
