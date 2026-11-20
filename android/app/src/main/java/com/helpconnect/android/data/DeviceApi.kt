package com.helpconnect.android.data

import com.helpconnect.android.BuildConfig
import com.helpconnect.android.domain.SessionInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

data class ResolvedDeviceSession(
    val sessionId: String,
    val expiresAt: String
)

class DeviceSessionRejectedException(val statusCode: Int) :
    IOException("Sessão ou credencial indisponível.")

class DeviceApiResponseException(val statusCode: Int) :
    IOException("A API respondeu com erro HTTP $statusCode.")

class DeviceApi(
    private val apiBaseUrl: String,
    private val client: OkHttpClient = defaultClient()
) {
    suspend fun resolveSession(publicCode: String, deviceToken: String): ResolvedDeviceSession =
        withContext(Dispatchers.IO) {
            val normalizedCode = SessionInput.normalizeCode(publicCode)
            require(SessionInput.isValidCode(normalizedCode)) { "Informe um código de atendimento válido." }
            require(SessionInput.isValidTicket(deviceToken)) { "Credencial temporária inválida." }
            val endpoint = endpoint("public/sessions/device-session")
            if (!BuildConfig.DEBUG && endpoint.isHttps.not()) {
                throw IOException("A API precisa usar HTTPS fora de uma compilação de depuração.")
            }

            val body = JSONObject()
                .put("publicCode", normalizedCode)
                .put("deviceToken", deviceToken.trim())
                .toString()
                .toRequestBody(JSON_MEDIA_TYPE)
            val request = Request.Builder()
                .url(endpoint)
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    if (response.code == 400 || response.code == 404) {
                        throw DeviceSessionRejectedException(response.code)
                    }
                    throw DeviceApiResponseException(response.code)
                }
                val json = JSONObject(responseBody)
                val sessionId = json.getString("sessionId")
                UUID.fromString(sessionId)
                ResolvedDeviceSession(sessionId, json.getString("expiresAt"))
            }
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
