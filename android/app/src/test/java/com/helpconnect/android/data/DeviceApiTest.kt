package com.helpconnect.android.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.UUID

class DeviceApiTest {
    @Test
    fun resolvesSessionUsingCodeAndTemporaryTicket() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(
            """{"sessionId":"${UUID.randomUUID()}","expiresAt":"2026-11-19T20:00:00.000Z"}"""
        ))
        server.start()
        try {
            val api = DeviceApi(server.url("/api").toString().trimEnd('/'))
            val session = api.resolveSession("hc-abcdef012345", "A".repeat(43))
            val request = server.takeRequest()
            val requestBody = request.body.readUtf8()

            assertEquals("/api/public/sessions/device-session", request.path)
            assertTrue(requestBody.contains("HC-ABCDEF012345"))
            assertTrue(requestBody.contains("A".repeat(43)))
            assertEquals("2026-11-19T20:00:00.000Z", session.expiresAt)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun rejectsInvalidCredentialsAndServerRejections(): Unit = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"unavailable"}"""))
        server.start()
        try {
            val api = DeviceApi(server.url("/api").toString().trimEnd('/'))
            val error = org.junit.Assert.assertThrows(IOException::class.java) {
                runBlocking { api.resolveSession("HC-ABCDEF012345", "A".repeat(43)) }
            }
            assertTrue(error.message!!.contains("inválida/expirada"))
            org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
                runBlocking { api.resolveSession("invalid", "short") }
            }
        } finally {
            server.shutdown()
        }
        Unit
    }

    @Test
    fun derivesWebsocketUrlFromApiPath() {
        val api = DeviceApi("https://support.example.com/api")
        assertEquals("wss://support.example.com/ws", api.websocketUrl())
        assertEquals(
            "wss://support.example.com/helpconnect/ws",
            DeviceApi("https://support.example.com/helpconnect/api").websocketUrl()
        )
    }

    @Test
    fun reportsNetworkFailure(): Unit = runBlocking {
        val server = MockWebServer()
        server.start()
        val apiUrl = server.url("/api").toString().trimEnd('/')
        server.shutdown()

        org.junit.Assert.assertThrows(IOException::class.java) {
            runBlocking { DeviceApi(apiUrl).resolveSession("HC-ABCDEF012345", "A".repeat(43)) }
        }
        Unit
    }
}
