package com.helpconnect.android.signaling

import org.json.JSONArray
import org.json.JSONObject

data class IceServerConfig(
    val urls: List<String>,
    val username: String?,
    val credential: String?
)

data class RemoteIceCandidate(
    val candidate: String,
    val sdpMid: String?,
    val sdpMLineIndex: Int?
)

sealed interface RemoteControlAction {
    data class Tap(val x: Int, val y: Int) : RemoteControlAction
    data class LongPress(val x: Int, val y: Int, val durationMs: Int) : RemoteControlAction
    data class Drag(
        val fromX: Int,
        val fromY: Int,
        val toX: Int,
        val toY: Int,
        val durationMs: Int
    ) : RemoteControlAction
    data class Global(val action: String) : RemoteControlAction
    data class TypeText(val text: String) : RemoteControlAction
}

data class RemoteControlCommand(
    val commandId: String,
    val action: RemoteControlAction
)

sealed interface ServerSignal {
    data class Joined(
        val participant: String,
        val nextSequence: Long,
        val connectionNonce: String,
        val iceServers: List<IceServerConfig>
    ) : ServerSignal

    data class Description(val type: String, val sdp: String) : ServerSignal
    data class IceCandidate(val candidate: RemoteIceCandidate?) : ServerSignal
    data class ConnectionState(val transport: String, val participant: String?, val state: String) : ServerSignal
    data class RemoteControlState(val available: Boolean) : ServerSignal
    data class RemoteControlCommandReceived(val command: RemoteControlCommand) : ServerSignal
    data class SessionEnded(val reason: String) : ServerSignal
    data class Error(val code: String, val message: String) : ServerSignal
    data object Left : ServerSignal
}

class SignalProtocolException(message: String) : Exception(message)

object SignalProtocol {
    private const val MAX_MESSAGE_BYTES = 16 * 1024
    private const val MAX_SDP_LENGTH = 12_000
    private const val NONCE_PATTERN = "^[A-Za-z0-9_-]{22}$"
    private const val UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"

    fun parse(raw: String): ServerSignal {
        if (raw.toByteArray(Charsets.UTF_8).size > MAX_MESSAGE_BYTES) {
            throw SignalProtocolException("Mensagem de sinalização excedeu o limite.")
        }
        val json = try {
            JSONObject(raw)
        } catch (_: Exception) {
            throw SignalProtocolException("Mensagem JSON inválida.")
        }
        return when (json.optString("type")) {
            "join_session" -> parseJoin(json)
            "offer", "answer" -> parseDescription(json)
            "ice_candidate" -> parseIceCandidate(json)
            "connection_state" -> ServerSignal.ConnectionState(
                json.requiredString("transport"),
                (json.optString("participant").ifEmpty { json.optString("sender") })
                    .takeIf(String::isNotEmpty),
                json.requiredString("state")
            )
            "remote_control_state" -> ServerSignal.RemoteControlState(
                json.opt("available") as? Boolean
                    ?: throw SignalProtocolException("Disponibilidade de interações inválida.")
            )
            "remote_control_command" -> parseRemoteControlCommand(json)
            "session_ended" -> ServerSignal.SessionEnded(json.optString("reason", "session_unavailable"))
            "error" -> ServerSignal.Error(
                json.optString("code", "UNKNOWN"),
                json.optString("message", "Falha na comunicação.")
            )
            "leave_session" -> ServerSignal.Left
            else -> throw SignalProtocolException("Tipo de mensagem de sinalização desconhecido.")
        }
    }

    fun joinMessage(sessionId: String, deviceToken: String): String = JSONObject()
        .put("type", "join_session")
        .put("sessionId", sessionId)
        .put("deviceToken", deviceToken)
        .toString()

    fun signalMessage(
        type: String,
        sequence: Long,
        connectionNonce: String,
        recipient: String,
        payload: JSONObject = JSONObject()
    ): String {
        require(type in setOf(
            "offer",
            "answer",
            "ice_candidate",
            "connection_state",
            "leave_session",
            "remote_control_state",
            "remote_control_result"
        ))
        require(sequence in 1..9_007_199_254_740_991L)
        require(connectionNonce.matches(Regex(NONCE_PATTERN)))
        if (type != "leave_session") require(recipient == "operator")
        val message = JSONObject()
            .put("type", type)
            .put("sequence", sequence)
            .put("connectionNonce", connectionNonce)
        if (type != "leave_session") message.put("recipient", recipient)
        payload.keys().forEach { key -> message.put(key, payload.get(key)) }
        return message.toString()
    }

    private fun parseJoin(json: JSONObject): ServerSignal.Joined {
        if (!json.optBoolean("accepted") || json.optString("participant") != "device") {
            throw SignalProtocolException("Entrada na sessão não foi autorizada.")
        }
        val nextSequence = json.optLong("nextSequence", -1)
        val nonce = json.optString("connectionNonce")
        if (nextSequence < 1 || !nonce.matches(Regex(NONCE_PATTERN))) {
            throw SignalProtocolException("Resposta de entrada inválida.")
        }
        val iceArray = json.optJSONArray("iceServers") ?: JSONArray()
        val servers = (0 until iceArray.length()).map { index ->
            val item = iceArray.getJSONObject(index)
            val rawUrls = item.get("urls")
            val urls = when (rawUrls) {
                is String -> listOf(rawUrls)
                is JSONArray -> (0 until rawUrls.length()).map { rawUrls.getString(it) }
                else -> emptyList()
            }
            if (urls.isEmpty()) throw SignalProtocolException("Servidor ICE inválido.")
            IceServerConfig(
                urls = urls,
                username = item.optString("username").takeIf(String::isNotEmpty),
                credential = item.optString("credential").takeIf(String::isNotEmpty)
            )
        }
        return ServerSignal.Joined("device", nextSequence, nonce, servers)
    }

    private fun parseDescription(json: JSONObject): ServerSignal.Description {
        val type = json.requiredString("type")
        val description = json.optJSONObject("sdp")
            ?: throw SignalProtocolException("Descrição SDP ausente.")
        val sdpType = description.requiredString("type")
        val sdp = description.requiredString("sdp")
        if (type != sdpType || sdpType !in setOf("offer", "answer") || sdp.length > MAX_SDP_LENGTH) {
            throw SignalProtocolException("Descrição SDP inválida.")
        }
        return ServerSignal.Description(sdpType, sdp)
    }

    private fun parseIceCandidate(json: JSONObject): ServerSignal.IceCandidate {
        val candidate = json.opt("candidate")
        if (candidate == null || candidate == JSONObject.NULL) return ServerSignal.IceCandidate(null)
        if (candidate !is JSONObject) throw SignalProtocolException("Candidate ICE inválido.")
        val value = candidate.requiredString("candidate")
        if (value.length > 4096) throw SignalProtocolException("Candidate ICE excedeu o limite.")
        val lineIndex = if (candidate.isNull("sdpMLineIndex")) {
            null
        } else {
            candidate.getInt("sdpMLineIndex").takeIf { it >= 0 }
                ?: throw SignalProtocolException("Índice de candidate ICE inválido.")
        }

        return ServerSignal.IceCandidate(
            RemoteIceCandidate(
                value,
                candidate.optString("sdpMid").takeIf(String::isNotEmpty),
                lineIndex
            )
        )
    }

    private fun parseRemoteControlCommand(json: JSONObject): ServerSignal.RemoteControlCommandReceived {
        val commandId = json.requiredUuid("commandId")
        val action = json.optJSONObject("action")
            ?: throw SignalProtocolException("Ação de controle ausente.")
        val parsed = when (action.requiredString("kind")) {
            "tap" -> RemoteControlAction.Tap(
                action.requiredCoordinate("x"),
                action.requiredCoordinate("y")
            )
            "long_press" -> RemoteControlAction.LongPress(
                action.requiredCoordinate("x"),
                action.requiredCoordinate("y"),
                action.requiredDuration("durationMs", 500, 2_000)
            )
            "drag" -> RemoteControlAction.Drag(
                action.requiredCoordinate("fromX"),
                action.requiredCoordinate("fromY"),
                action.requiredCoordinate("toX"),
                action.requiredCoordinate("toY"),
                action.requiredDuration("durationMs", 100, 1_500)
            )
            "global" -> action.requiredString("action").takeIf { it in setOf("BACK", "HOME", "RECENTS") }
                ?.let { RemoteControlAction.Global(it) }
                ?: throw SignalProtocolException("Ação global de controle inválida.")
            "type_text" -> action.requiredString("text")
                .takeIf { it.length <= 512 }
                ?.let { RemoteControlAction.TypeText(it) }
                ?: throw SignalProtocolException("Texto de controle excedeu o limite.")
            else -> throw SignalProtocolException("Tipo de ação de controle desconhecido.")
        }
        return ServerSignal.RemoteControlCommandReceived(
            RemoteControlCommand(commandId, parsed)
        )
    }

    private fun JSONObject.requiredCoordinate(key: String): Int {
        val value = opt(key)
        if (value !is Number) throw SignalProtocolException("Coordenada ausente: $key.")
        val coordinate = value.toInt()
        if (value.toDouble() != coordinate.toDouble() || coordinate !in 0..10_000) {
            throw SignalProtocolException("Coordenada de controle inválida: $key.")
        }
        return coordinate
    }

    private fun JSONObject.requiredDuration(key: String, minimum: Int, maximum: Int): Int {
        val value = opt(key)
        if (value !is Number) throw SignalProtocolException("Duração de controle ausente: $key.")
        val duration = value.toInt()
        if (value.toDouble() != duration.toDouble() || duration !in minimum..maximum) {
            throw SignalProtocolException("Duração de controle inválida: $key.")
        }
        return duration
    }

    private fun JSONObject.requiredString(key: String): String =
        optString(key).takeIf(String::isNotEmpty)
            ?: throw SignalProtocolException("Campo obrigatório ausente: $key.")

    private fun JSONObject.requiredUuid(key: String): String =
        requiredString(key).takeIf { it.matches(Regex(UUID_PATTERN)) }
            ?: throw SignalProtocolException("Identificador de controle inválido: $key.")
}
