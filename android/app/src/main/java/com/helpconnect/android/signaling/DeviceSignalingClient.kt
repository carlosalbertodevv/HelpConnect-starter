package com.helpconnect.android.signaling

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class DeviceSignalingClient(
    private val websocketUrl: String,
    private val listener: Listener,
    private val client: OkHttpClient = defaultClient()
) {
    interface Listener {
        fun onJoined(iceServers: List<IceServerConfig>)
        fun onDescription(type: String, sdp: String)
        fun onIceCandidate(candidate: RemoteIceCandidate?)
        fun onPeerState(transport: String, participant: String?, state: String)
        fun onRemoteControlState(available: Boolean) = Unit
        fun onRemoteControlCommand(command: RemoteControlCommand) = Unit
        fun onRemoteControlFailure(message: String) = Unit
        fun onSessionEnded(reason: String)
        fun onFailure(message: String)
    }

    private val sequencer = SignalSequencer()
    private val terminal = AtomicBoolean(false)
    @Volatile private var socket: WebSocket? = null
    @Volatile private var joined = false
    @Volatile private var intentionallyClosed = false

    fun connect(sessionId: String, deviceToken: String) {
        check(socket == null) { "A signaling socket already exists." }
        val request = Request.Builder().url(websocketUrl).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (!webSocket.send(SignalProtocol.joinMessage(sessionId, deviceToken))) {
                    fail("Não foi possível enviar a autenticação do dispositivo.")
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    handleSignal(SignalProtocol.parse(text))
                } catch (_: Exception) {
                    fail("O servidor enviou uma mensagem de sinalização inválida.")
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!intentionallyClosed) {
                    Log.e(TAG, "WebSocket signaling failed", t)
                    fail("A conexão WebSocket falhou. Gere uma nova credencial no painel antes de tentar novamente.")
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!intentionallyClosed && !terminal.get()) {
                    Log.w(TAG, "WebSocket signaling closed unexpectedly (code=$code)")
                    fail("A conexão WebSocket foi encerrada. Gere uma nova credencial antes de reconectar.")
                }
            }
        })
    }

    fun sendOffer(sdp: String) = sendDescription("offer", sdp)

    fun sendAnswer(sdp: String) = sendDescription("answer", sdp)

    private fun sendDescription(type: String, sdp: String) {
        val payload = JSONObject().put("sdp", JSONObject().put("type", type).put("sdp", sdp))
        send(type, "operator", payload)
    }

    fun sendIceCandidate(candidate: String?, sdpMid: String? = null, sdpMLineIndex: Int? = null) {
        val payload = JSONObject()
        if (candidate == null) {
            payload.put("candidate", JSONObject.NULL)
        } else {
            val value = JSONObject().put("candidate", candidate)
            if (sdpMid != null) value.put("sdpMid", sdpMid)
            if (sdpMLineIndex != null) value.put("sdpMLineIndex", sdpMLineIndex)
            payload.put("candidate", value)
        }
        send("ice_candidate", "operator", payload)
    }

    fun sendConnectionState(state: String) {
        val payload = JSONObject()
            .put("transport", "webrtc")
            .put("state", state)
        send("connection_state", "operator", payload)
    }

    fun sendRemoteControlState(available: Boolean) {
        send(
            "remote_control_state",
            "operator",
            JSONObject().put("available", available)
        )
    }

    fun sendRemoteControlResult(
        command: RemoteControlCommand,
        status: String,
        errorCode: String? = null
    ) {
        val payload = JSONObject()
            .put("commandId", command.commandId)
            .put("status", status)
        if (errorCode != null) payload.put("errorCode", errorCode)
        send("remote_control_result", "operator", payload)
    }

    private fun send(type: String, recipient: String, payload: JSONObject) {
        if (!joined || terminal.get()) return
        val message = SignalProtocol.signalMessage(
            type,
            sequencer.nextSequence(),
            sequencer.connectionNonce(),
            recipient,
            payload
        )
        if (socket?.send(message) != true) {
            Log.e(TAG, "Unable to send signaling message (type=$type)")
            fail("Não foi possível enviar sinalização ao atendente.")
        }
    }

    private fun handleSignal(signal: ServerSignal) {
        when (signal) {
            is ServerSignal.Joined -> {
                if (joined || signal.participant != "device") {
                    fail("Resposta de entrada inesperada.")
                    return
                }
                sequencer.initialize(signal.nextSequence, signal.connectionNonce)
                joined = true
                listener.onJoined(signal.iceServers)
            }
            is ServerSignal.Description -> listener.onDescription(signal.type, signal.sdp)
            is ServerSignal.IceCandidate -> listener.onIceCandidate(signal.candidate)
            is ServerSignal.ConnectionState ->
                listener.onPeerState(signal.transport, signal.participant, signal.state)
            is ServerSignal.RemoteControlState -> listener.onRemoteControlState(signal.available)
            is ServerSignal.RemoteControlCommandReceived -> listener.onRemoteControlCommand(signal.command)
            is ServerSignal.SessionEnded -> {
                if (terminal.compareAndSet(false, true)) listener.onSessionEnded(signal.reason)
            }
            is ServerSignal.Error -> {
                if (
                    signal.code.startsWith("CONTROL_") ||
                    signal.code in setOf("DUPLICATE_COMMAND", "INVALID_CONTROL_RESULT", "RATE_LIMITED")
                ) {
                    listener.onRemoteControlFailure(signal.message)
                    return
                }
                val message = when (signal.code) {
                    "UNAUTHENTICATED" -> "Credencial inválida, expirada ou já utilizada. Solicite uma nova."
                    "SESSION_FORBIDDEN" -> "A sessão expirou, foi encerrada ou não possui consentimento ativo."
                    "REPLACED" -> "Esta conexão foi substituída por outra conexão do dispositivo."
                    else -> signal.message
                }
                fail(message)
            }
            ServerSignal.Left -> {
                if (!intentionallyClosed) fail("A participação no atendimento foi encerrada.")
            }
        }
    }

    fun disconnect() {
        intentionallyClosed = true
        if (joined && !terminal.get()) {
            socket?.send(
                SignalProtocol.signalMessage(
                    "leave_session",
                    sequencer.nextSequence(),
                    sequencer.connectionNonce(),
                    "operator"
                )
            )
        }
        socket?.close(1000, "Device left")
        socket = null
        joined = false
    }

    private fun fail(message: String) {
        if (terminal.compareAndSet(false, true)) {
            Log.w(TAG, "Signaling session failed")
            listener.onFailure(message)
            socket?.cancel()
        }
    }

    companion object {
        private const val TAG = "DeviceSignaling"

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }
}
