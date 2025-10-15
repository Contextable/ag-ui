package com.agui.server

import co.touchlab.kermit.Logger
import com.agui.core.types.AgUiJson
import com.agui.core.types.BaseEvent
import com.agui.core.types.RunAgentInput
import com.agui.core.types.RunErrorEvent
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.call
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respondTextWriter
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val logger = Logger.withTag("AgUiStreamingEndpoint")

/**
 * Installs an AG-UI compliant HTTP streaming endpoint on the provided [Route].
 *
 * The endpoint accepts a `RunAgentInput` payload via POST and streams AG-UI
 * events back to the caller using newline-delimited JSON within the HTTP
 * response body. Any exception thrown while producing events is surfaced to the
 * client as a `RUN_ERROR` event so consumers receive structured failure
 * information.
 *
 * @param path Endpoint path relative to the current route (default: "/")
 * @param json JSON serializer used to encode events (defaults to [AgUiJson])
 * @param agentRunner Callback that produces a flow of AG-UI events for the
 * provided [RunAgentInput].
 */
fun Route.aguiStreamingAgent(
    path: String = "/",
    json: Json = AgUiJson,
    agentRunner: suspend ApplicationCall.(RunAgentInput) -> Flow<BaseEvent>
) {
    post(path) {
        val input = call.receive<RunAgentInput>()

        call.response.header(HttpHeaders.CacheControl, "no-cache")
        call.response.header(HttpHeaders.ContentType, ContentType.Application.Json.toString())

        call.respondTextWriter(contentType = ContentType.Application.Json) {
            try {
                agentRunner(call, input).collect { event ->
                    val payload = json.encodeToString(BaseEvent.serializer(), event)
                    write(payload)
                    write("\n")
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
                val payload = json.encodeToString(BaseEvent.serializer(), errorEvent)
                write(payload)
                write("\n")
                flush()
            }
        }
    }
}
