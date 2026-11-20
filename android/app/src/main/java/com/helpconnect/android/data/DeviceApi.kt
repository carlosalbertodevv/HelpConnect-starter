package com.helpconnect.android.data

import com.helpconnect.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

data class DeviceSessionCandidate(
    val sessionId: String,
    val publicCode: String,
    val clientName: String?,
    val status: String,
    val expiresAt: String
)

data class AuthorizedDeviceSession(
    val sessionId: String,
    val publicCode: String,
    val clientName: String?,
    val deviceToken: String,
    val expiresAt: String
)

class DevicePairingRequiredException(val pairingCode: String) :
    IOException("Este aparelho precisa ser vinculado ao cadastro do cliente.")

class DeviceSessionRejectedException(val statusCode: Int, message: String) : IOException(message)

class DeviceApiResponseException(val statusCode: Int) :
    IOException("A API respondeu com erro HTTP $statusCode.")

class DeviceApi(
    private val apiBaseUrl: String,
    private val client: OkHttpClient = defaultClient()
) {
    suspend fun resolveSession(keyword: String, identity: DeviceIdentity): DeviceSessionCandidate =
        withContext(Dispatchers.IO) {
            require(keyword.isNotBlank()) { "Digite a palavra-chave." }
            val challenge = requestChallenge()
            val json = post(
                "public/sessions/device-session",
                proofBody(keyword, challenge, identity)
            )
            DeviceSessionCandidate(
                sessionId = UUID.fromString(json.getString("sessionId")).toString(),
                publicCode = json.getString("publicCode"),
                clientName = if (json.isNull("clientName")) null else json.getString("clientName"),
                status = json.getString("status"),
                expiresAt = json.getString("expiresAt")
            )
        }

    suspend fun confirmSession(
        keyword: String,
        sessionId: String,
        identity: DeviceIdentity
    ): AuthorizedDeviceSession = withContext(Dispatchers.IO) {
        require(keyword.isNotBlank()) { "Digite a palavra-chave." }
        val challenge = requestChallenge()
        val normalizedSessionId = UUID.fromString(sessionId).toString()
        val body = proofBody(keyword, challenge, identity, normalizedSessionId)
            .put("sessionId", normalizedSessionId)
            .put("accepted", true)
        val json = post("public/sessions/device-consent", body)
        AuthorizedDeviceSession(
            sessionId = UUID.fromString(json.getString("sessionId")).toString(),
            publicCode = json.getString("publicCode"),
            clientName = if (json.isNull("clientName")) null else json.getString("clientName"),
            deviceToken = json.getString("deviceToken"),
            expiresAt = json.getString("expiresAt")
        )
    }

    fun websocketUrl(): String {
        val apiUrl = parseApiBaseUrl()
        require(apiUrl.encodedPath.trimEnd('/').endsWith("/api")) {
            "A URL da API deve terminar em /api."
        }
        return apiUrl.newBuilder()
            .encodedPath(apiUrl.encodedPath.substringBeforeLast("/api").trimEnd('/') + "/ws")
            .query(null)
            .fragment(null)
            .build()
            .toString()
            .replaceFirst(Regex("^https?://"), if (apiUrl.isHttps) "wss://" else "ws://")
    }

    private fun requestChallenge(): String =
        post("public/sessions/device-challenge", JSONObject()).getString("challenge")

    private fun proofBody(
        keyword: String,
        challenge: String,
        identity: DeviceIdentity,
        sessionId: String? = null
    ): JSONObject {
        val normalizedKeyword = keyword.trim().uppercase(java.util.Locale.ROOT)
        val sessionContext = sessionId?.let { ":SESSION:$it" }.orEmpty()
        val consentContext = if (sessionId != null) ":CONSENT:ACCEPTED" else ""
        val payload = "HELPCONNECT:DEVICE_SESSION:$challenge:$normalizedKeyword$sessionContext$consentContext"
        return JSONObject()
            .put("keyword", keyword)
            .put("publicKey", identity.publicKey())
            .put("challenge", challenge)
            .put("signature", identity.sign(payload))
    }

    private fun post(path: String, body: JSONObject): JSONObject {
        val endpoint = endpoint(path)
        if (!BuildConfig.DEBUG && endpoint.isHttps.not()) {
            throw IOException("A API precisa usar HTTPS fora de uma compilação de depuração.")
        }
        val request = Request.Builder()
            .url(endpoint)
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()
        client.newCall(request).execute().use { response ->
            val responseBody = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val errorBody = try {
                    JSONObject(responseBody)
                } catch (_: JSONException) {
                    null
                }
                if (response.code == 428) {
                    val pairingCode = errorBody?.optString("pairingCode").orEmpty()
                    if (pairingCode.isNotBlank()) throw DevicePairingRequiredException(pairingCode)
                }
                if (response.code in setOf(400, 401, 403, 404, 409)) {
                    throw DeviceSessionRejectedException(
                        response.code,
                        errorBody?.optString("error")?.takeIf(String::isNotBlank)
                            ?: "Sessão ou aparelho indisponível."
                    )
                }
                throw DeviceApiResponseException(response.code)
            }
            return JSONObject(responseBody)
        }
    }

    private fun endpoint(path: String): HttpUrl {
        val apiUrl = parseApiBaseUrl()
        require(apiUrl.encodedPath.trimEnd('/').endsWith("/api")) {
            "A URL da API deve terminar em /api."
        }
        return apiUrl.newBuilder()
            .addPathSegments(path)
            .query(null)
            .fragment(null)
            .build()
    }

    private fun parseApiBaseUrl(): HttpUrl {
        val url = apiBaseUrl.trim().toHttpUrlOrNull()
            ?: throw IOException("Configure uma URL absoluta e válida para a API HelpConnect.")
        if (url.query != null || url.fragment != null) {
            throw IOException("A URL da API não pode conter query string ou fragmento.")
        }
        return url
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }
}
