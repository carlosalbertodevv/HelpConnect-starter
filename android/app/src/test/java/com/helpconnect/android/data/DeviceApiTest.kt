package com.helpconnect.android.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64
import java.util.UUID

class DeviceApiTest {
    @Test
    fun resolvesSessionUsingKeywordAndSignedDeviceIdentity() = runBlocking {
        val server = MockWebServer()
        val identity = TestDeviceIdentity()
        val challenge = "C".repeat(43)
        server.enqueue(MockResponse().setBody("""{"challenge":"$challenge"}"""))
        server.enqueue(MockResponse().setBody(
            """{"sessionId":"${UUID.randomUUID()}","publicCode":"HC-ABCDEF012345","clientName":"Cliente Teste","status":"PENDING","expiresAt":"2026-11-20T20:00:00.000Z"}"""
        ))
        server.start()
        try {
            val api = DeviceApi(server.url("/api").toString().trimEnd('/'))
            val session = api.resolveSession("EUQUERO", identity)
            val challengeRequest = server.takeRequest()
            val request = server.takeRequest()
            val bodyJson = org.json.JSONObject(request.body.readUtf8())

            assertEquals("/api/public/sessions/device-challenge", challengeRequest.path)
            assertEquals("/api/public/sessions/device-session", request.path)
            assertEquals("EUQUERO", bodyJson.getString("keyword"))
            assertEquals(identity.publicKey(), bodyJson.getString("publicKey"))
            assertTrue(bodyJson.getString("signature").isNotBlank())
            assertEquals(challenge, bodyJson.getString("challenge"))
            assertEquals("HC-ABCDEF012345", session.publicCode)
            assertEquals("Cliente Teste", session.clientName)
            assertEquals("PENDING", session.status)
            assertEquals("2026-11-20T20:00:00.000Z", session.expiresAt)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun confirmationReturnsTheTemporaryWebsocketCredential() = runBlocking {
        val server = MockWebServer()
        val identity = TestDeviceIdentity()
        val sessionId = UUID.randomUUID()
        server.enqueue(MockResponse().setBody("""{"challenge":"${"D".repeat(43)}"}"""))
        server.enqueue(MockResponse().setBody(
            """{"sessionId":"$sessionId","publicCode":"HC-ABCDEF012345","clientName":"Cliente Teste","deviceToken":"${"A".repeat(43)}","expiresAt":"2026-11-20T20:00:00.000Z"}"""
        ))
        server.start()
        try {
            val api = DeviceApi(server.url("/api").toString().trimEnd('/'))
            val session = api.confirmSession("EUQUERO", sessionId.toString(), identity)
            server.takeRequest()
            val request = server.takeRequest()
            val bodyJson = org.json.JSONObject(request.body.readUtf8())
            val payload = "HELPCONNECT:DEVICE_SESSION:${"D".repeat(43)}:EUQUERO:SESSION:$sessionId:CONSENT:ACCEPTED"

            assertEquals("/api/public/sessions/device-consent", request.path)
            assertEquals(sessionId.toString(), bodyJson.getString("sessionId"))
            assertTrue(bodyJson.getBoolean("accepted"))
            assertEquals("EUQUERO", bodyJson.getString("keyword"))
            assertTrue(identity.verify(payload, bodyJson.getString("signature")))
            assertFalse(identity.verify(payload.replace(sessionId.toString(), UUID.randomUUID().toString()), bodyJson.getString("signature")))
            assertEquals("A".repeat(43), session.deviceToken)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun serverRejectsInvalidKeywordAndUnavailableDeviceSession(): Unit = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"challenge":"${"C".repeat(43)}"}"""))
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"invalid keyword"}"""))
        server.enqueue(MockResponse().setBody("""{"challenge":"${"D".repeat(43)}"}"""))
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"unavailable"}"""))
        server.start()
        try {
            val api = DeviceApi(server.url("/api").toString().trimEnd('/'))
            val keywordError = org.junit.Assert.assertThrows(DeviceSessionRejectedException::class.java) {
                runBlocking { api.resolveSession("PALAVRA-ERRADA", TestDeviceIdentity()) }
            }
            assertEquals(400, keywordError.statusCode)
            val sessionError = org.junit.Assert.assertThrows(DeviceSessionRejectedException::class.java) {
                runBlocking { api.resolveSession("EUQUERO", TestDeviceIdentity()) }
            }
            assertEquals(404, sessionError.statusCode)
        } finally {
            server.shutdown()
        }
        Unit
    }

    @Test
    fun reportsUnexpectedHttpErrorsSeparatelyFromRejectedCredentials(): Unit = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"challenge":"${"C".repeat(43)}"}"""))
        server.enqueue(MockResponse().setResponseCode(503))
        server.start()
        try {
            val api = DeviceApi(server.url("/api").toString().trimEnd('/'))
            val error = org.junit.Assert.assertThrows(DeviceApiResponseException::class.java) {
                runBlocking { api.resolveSession("EUQUERO", TestDeviceIdentity()) }
            }
            assertEquals(503, error.statusCode)
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

        val error = org.junit.Assert.assertThrows(IOException::class.java) {
            runBlocking { DeviceApi(apiUrl).resolveSession("EUQUERO", TestDeviceIdentity()) }
        }
        assertFalse(error is DeviceApiResponseException || error is DeviceSessionRejectedException)
        Unit
    }
}

private class TestDeviceIdentity : DeviceIdentity {
    private val keyPair: KeyPair = KeyPairGenerator.getInstance("EC").apply {
        initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()

    override fun publicKey(): String = Base64.getEncoder().encodeToString(keyPair.public.encoded)

    override fun sign(message: String): String {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(keyPair.private)
        signature.update(message.toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign())
    }

    fun verify(message: String, signedMessage: String): Boolean {
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(keyPair.public)
        verifier.update(message.toByteArray(Charsets.UTF_8))
        return verifier.verify(Base64.getUrlDecoder().decode(signedMessage))
    }
}
