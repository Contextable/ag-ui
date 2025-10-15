package com.agui.client.agent

import io.ktor.client.*
import io.ktor.client.engine.android.*
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.http.*
import com.agui.core.types.AgUiJson

/**
 * Android-specific HttpClient factory
 */
internal actual fun createPlatformHttpClient(
    requestTimeout: Long,
    connectTimeout: Long
): HttpClient = HttpClient(Android) {
    expectSuccess = false

    install(ContentNegotiation) {
        json(AgUiJson)
    }

    install(HttpTimeout) {
        requestTimeoutMillis = requestTimeout
        connectTimeoutMillis = connectTimeout
    }
}