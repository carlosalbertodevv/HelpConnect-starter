package com.helpconnect.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.Activity
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.helpconnect.android.accessibility.RemoteControlAccessibilityService
import com.helpconnect.android.R
import com.helpconnect.android.data.AndroidDeviceIdentity
import com.helpconnect.android.data.ApiEndpoint
import com.helpconnect.android.data.DeviceApi
import com.helpconnect.android.data.DeviceApiResponseException
import com.helpconnect.android.data.DevicePairingRequiredException
import com.helpconnect.android.data.DeviceSessionRejectedException
import com.helpconnect.android.presentation.MainActivity
import com.helpconnect.android.signaling.DeviceSignalingClient
import com.helpconnect.android.signaling.IceServerConfig
import com.helpconnect.android.signaling.RemoteIceCandidate
import com.helpconnect.android.signaling.RemoteControlCommand
import com.helpconnect.android.webrtc.WebRtcScreenPublisher
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.content.Context
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

enum class SessionScreen {
    HOME,
    AWAITING_CONFIRMATION,
    CONNECTING,
    CONNECTED,
    SHARING,
    ENDED
}

data class SessionUiState(
    val screen: SessionScreen = SessionScreen.HOME,
    val status: String = "",
    val sessionId: String = "",
    val publicCode: String = "",
    val clientName: String? = null,
    val pairingCode: String? = null,
    val webrtcState: String = "aguardando",
    val error: String? = null,
    val canShare: Boolean = false,
    val remoteInteractionStatus: String = " ",
    val remoteInteractionAvailable: Boolean = false,
    val accessibilityEnabled: Boolean = false
)

class HelpConnectService : Service(), DeviceSignalingClient.Listener {
    interface StateListener {
        fun onStateChanged(state: SessionUiState)
    }

    inner class LocalBinder : Binder() {
        fun service(): HelpConnectService = this@HelpConnectService
    }

    private val binder = LocalBinder()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val terminal = AtomicBoolean(false)
    private val sessionGeneration = AtomicLong(0)
    @Volatile private var listener: StateListener? = null
    @Volatile private var state = SessionUiState()
    @Volatile private var pendingKeyword = ""
    @Volatile private var signalingClient: DeviceSignalingClient? = null
    @Volatile private var publisher: WebRtcScreenPublisher? = null
    @Volatile private var iceServers: List<IceServerConfig> = emptyList()
    @Volatile private var sessionJoined = false
    @Volatile private var isSharing = false
    @Volatile private var operatorConnected = false
    @Volatile private var operatorWebrtcConnected = false
    @Volatile private var webrtcConnected = false
    @Volatile private var pendingProjectionResultCode: Int? = null
    @Volatile private var pendingProjectionData: Intent? = null
    @Volatile private var remoteControlAvailable = false
    @Volatile private var remoteControlServerBlocked = false
    private val seenRemoteCommandIds = LinkedHashSet<String>()

    override fun onCreate() {
        super.onCreate()
        RemoteControlAccessibilityService.setAuthorizationLostListener {
            mainHandler.post { disableRemoteInteractions("O serviço de acessibilidade foi desativado.") }
        }
    }

    fun setStateListener(value: StateListener?) {
        listener = value
        value?.let { emit(state) }
    }

    fun currentState(): SessionUiState = state

    fun connect(keyword: String) {
        if (state.screen != SessionScreen.HOME && state.screen != SessionScreen.ENDED) {
            update(state.copy(error = "Já existe um atendimento em andamento."))
            return
        }
        if (keyword.isBlank()) {
            update(SessionUiState(error = "Digite a palavra-chave EUQUERO."))
            return
        }

        val generation = sessionGeneration.incrementAndGet()
        terminal.set(false)
        sessionJoined = false
        operatorConnected = false
        operatorWebrtcConnected = false
        webrtcConnected = false
        clearRemoteControlState()
        iceServers = emptyList()
        update(SessionUiState(
            screen = SessionScreen.CONNECTING,
            status = " "
        ))
        startService(Intent(this@HelpConnectService, HelpConnectService::class.java))
        serviceScope.launch {
            try {
                val api = DeviceApi(ApiEndpoint.baseUrl())
                val session = api.resolveSession(keyword, AndroidDeviceIdentity())
                if (!isCurrent(generation)) return@launch
                pendingKeyword = keyword
                update(SessionUiState(
                    screen = SessionScreen.AWAITING_CONFIRMATION,
                    status = " ",
                    sessionId = session.sessionId,
                    publicCode = session.publicCode,
                    clientName = session.clientName
                ))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: DevicePairingRequiredException) {
                terminal.set(true)
                pendingKeyword = ""
                update(SessionUiState(
                    status = "Informe este código ao consultor.",
                    pairingCode = error.pairingCode
                ))
                stopSelf()
            } catch (error: DeviceSessionRejectedException) {
                showConnectionSetupError(
                    generation,
                    "Não foi possível localizar o atendimento.",
                    error.message ?: "O aparelho ou o atendimento está indisponível."
                )
            } catch (error: DeviceApiResponseException) {
                showConnectionSetupError(
                    generation,
                    "O backend não conseguiu validar a sessão. Tente novamente.",
                    error.message ?: "A API HelpConnect respondeu com erro."
                )
            } catch (error: IOException) {
                showConnectionSetupError(
                    generation,
                    "Não foi possível alcançar o backend.",
                    "Verifique se o backend está em execução e se a rede está disponível; depois, tente novamente."
                )
            } catch (_: Exception) {
                showConnectionSetupError(
                    generation,
                    "Não foi possível iniciar a conexão.",
                    "Verifique a configuração do aplicativo e tente novamente."
                )
            }
        }
    }

    fun confirmSession() {
        val candidate = state
        val keyword = pendingKeyword
        if (candidate.screen != SessionScreen.AWAITING_CONFIRMATION || keyword.isBlank()) return

        val generation = sessionGeneration.incrementAndGet()
        terminal.set(false)
        update(candidate.copy(
            screen = SessionScreen.CONNECTING,
            status = " ",
            error = null
        ))
        serviceScope.launch {
            try {
                val api = DeviceApi(ApiEndpoint.baseUrl())
                val session = api.confirmSession(keyword, candidate.sessionId, AndroidDeviceIdentity())
                if (!isCurrent(generation)) return@launch
                pendingKeyword = ""
                update(SessionUiState(
                    screen = SessionScreen.CONNECTING,
                    status = "Confirmação registrada. Aguardando a conexão do atendente...",
                    sessionId = session.sessionId,
                    publicCode = session.publicCode,
                    clientName = session.clientName
                ))
                val client = DeviceSignalingClient(api.websocketUrl(), listenerFor(generation))
                signalingClient = client
                client.connect(session.sessionId, session.deviceToken)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: DevicePairingRequiredException) {
                terminal.set(true)
                pendingKeyword = ""
                update(SessionUiState(
                    status = "Informe este código ao consultor.",
                    pairingCode = error.pairingCode
                ))
                stopSelf()
            } catch (error: DeviceSessionRejectedException) {
                showConnectionSetupError(
                    generation,
                    "Não foi possível confirmar o atendimento.",
                    error.message ?: "A sessão não está mais disponível."
                )
            } catch (error: DeviceApiResponseException) {
                showConnectionSetupError(
                    generation,
                    "O backend não conseguiu registrar a confirmação.",
                    error.message ?: "A API HelpConnect respondeu com erro."
                )
            } catch (error: IOException) {
                showConnectionSetupError(
                    generation,
                    "Não foi possível alcançar o backend.",
                    "Verifique se o backend e a rede estão disponíveis; depois, digite EUQUERO novamente."
                )
            } catch (_: Exception) {
                showConnectionSetupError(
                    generation,
                    "Não foi possível iniciar a conexão.",
                    "Verifique a configuração do aplicativo e tente novamente."
                )
            }
        }
    }

    fun cancelSessionConfirmation() {
        if (state.screen != SessionScreen.AWAITING_CONFIRMATION) return
        pendingKeyword = ""
        pendingProjectionResultCode = null
        pendingProjectionData = null
        sessionGeneration.incrementAndGet()
        terminal.set(true)
        update(SessionUiState(status = "Atendimento não confirmado. Nenhum compartilhamento foi iniciado."))
        stopSelf()
    }

    fun startScreenShare(resultCode: Int, permissionData: Intent) {
        if (resultCode != Activity.RESULT_OK) {
            update(state.copy(error = "Autorização de captura cancelada. Nenhuma tela foi compartilhada."))
            return
        }
        if (!sessionJoined || !operatorConnected || terminal.get()) {
            if (!terminal.get()) {
                pendingProjectionResultCode = resultCode
                pendingProjectionData = permissionData
                update(state.copy(
                    status = " ",
                    error = null
                ))
            }
            return
        }
        if (isSharing) {
            return
        }
        val generation = sessionGeneration.get()
        try {
            createNotificationChannel()
            if (!notificationsVisible()) {
                update(state.copy(error = "Ative a notificação do HelpConnect antes de iniciar a captura."))
                return
            }
            val notification = buildSharingNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (_: SecurityException) {
            Log.e(TAG, "Android rejected the media-projection foreground service")
            update(state.copy(error = "O Android não autorizou o serviço visível de captura."))
            return
        }
        Log.i(TAG, "Media-projection foreground service started")
        if (!isCurrent(generation)) {
            stopForegroundCompat()
            return
        }

        isSharing = true
        webrtcConnected = false
        update(state.copy(
            screen = SessionScreen.SHARING,
            status = " ",
            webrtcState = "connecting",
            error = null
        ))
        serviceScope.launch {
            if (!isCurrent(generation)) return@launch
            try {
                val screenPublisher = WebRtcScreenPublisher(
                    applicationContext,
                    onLocalDescription = { type, sdp ->
                        if (isCurrent(generation) && isSharing) {
                            if (type == "offer") signalingClient?.sendOffer(sdp)
                            else signalingClient?.sendAnswer(sdp)
                        }
                    },
                    onLocalCandidate = { candidate ->
                        if (isCurrent(generation) && isSharing) {
                            signalingClient?.sendIceCandidate(
                                candidate?.sdp,
                                candidate?.sdpMid,
                                candidate?.sdpMLineIndex
                            )
                        }
                    },
                    onCaptureStarted = {
                        if (isCurrent(generation)) {
                            update(state.copy(
                                screen = SessionScreen.SHARING,
                                status = " ",
                                error = null
                            ))
                        }
                    },
                    onConnectionState = { connectionState ->
                        if (isCurrent(generation)) {
                            webrtcConnected = connectionState == "connected"
                            if (webrtcConnected) remoteControlServerBlocked = false
                            signalingClient?.sendConnectionState(connectionState)
                            updateRemoteControlAvailability()
                            if (connectionState == "failed") {
                                terminate(
                                    "A conexão WebRTC falhou. A captura foi interrompida.",
                                    error = "Falha na conexão WebRTC; digite EUQUERO novamente para tentar reconectar."
                                )
                            } else {
                                update(state.copy(
                                    screen = if (isSharing) SessionScreen.SHARING else SessionScreen.CONNECTED,
                                    status = when {
                                        !isSharing -> state.status
                                        connectionState == "connected" -> ""
                                        else -> ""
                                    },
                                    webrtcState = connectionState
                                ))
                            }
                        }
                    },
                    onProjectionStopped = {
                        if (isCurrent(generation)) {
                            Log.w(TAG, "MediaProjection was stopped by the system or user")
                            mainHandler.post {
                                stopScreenShare(" ")
                            }
                        }
                    },
                    onFailure = { message ->
                        if (isCurrent(generation)) {
                            Log.e(TAG, "WebRTC publisher reported a failure")
                            terminate(message, error = message)
                        }
                    }
                )
                publisher = screenPublisher
                if (!isCurrent(generation)) {
                    screenPublisher.close()
                    return@launch
                }
                screenPublisher.start(permissionData, iceServers)
            } catch (error: Exception) {
                if (isCurrent(generation)) {
                    Log.e(TAG, "Unable to initialize the WebRTC screen publisher", error)
                    terminate("Não foi possível iniciar a captura WebRTC.", error = "Falha ao iniciar a captura.")
                }
            }
        }
    }

    fun stopScreenShare(message: String = " ") {
        val generation = sessionGeneration.get()
        webrtcConnected = false
        val activePublisher = publisher
        publisher = null
        isSharing = false
        updateRemoteControlAvailability()
        mainHandler.post { stopForegroundCompat() }
        serviceScope.launch {
            activePublisher?.close()
            signalingClient?.sendConnectionState("closed")
            withContext(Dispatchers.Main) {
                if (isCurrent(generation)) {
                    update(state.copy(
                        screen = SessionScreen.CONNECTED,
                        status = message,
                        webrtcState = "closed",
                        error = null
                    ))
                }
            }
        }
    }

    fun cancelSession() {
        terminate("Atendimento cancelado. A transmissão foi interrompida.", error = null)
    }

    fun showStatus(message: String) {
        update(state.copy(status = message))
    }

    fun reset() {
        sessionGeneration.incrementAndGet()
        terminal.set(false)
        pendingKeyword = ""
        pendingProjectionResultCode = null
        pendingProjectionData = null
        operatorConnected = false
        operatorWebrtcConnected = false
        webrtcConnected = false
        sessionJoined = false
        clearRemoteControlState()
        iceServers = emptyList()
        update(SessionUiState())
    }

    fun refreshAccessibilityStatus() {
        val enabled = RemoteControlAccessibilityService.isEnabled(this)
        if (!enabled) disableRemoteInteractions(" ")
        else updateRemoteControlAvailability()
        update(state.copy(accessibilityEnabled = enabled))
    }

    override fun onJoined(iceServers: List<IceServerConfig>) {
        if (terminal.get()) return
        this.iceServers = iceServers
        sessionJoined = true
        webrtcConnected = false
        operatorWebrtcConnected = false
        clearRemoteControlState()
        update(state.copy(
            screen = SessionScreen.CONNECTED,
            status = " ",
            error = null
        ))
    }

    override fun onDescription(type: String, sdp: String) {
        if (!isSharing || terminal.get()) return
        publisher?.onRemoteDescription(type, sdp)
    }

    override fun onIceCandidate(candidate: RemoteIceCandidate?) {
        if (!isSharing || terminal.get()) return
        publisher?.onRemoteIceCandidate(candidate)
    }

    override fun onPeerState(transport: String, participant: String?, state: String) {
        if (participant != "operator") return
        if (transport == "webrtc") {
            operatorWebrtcConnected = state == "connected"
            if (!operatorWebrtcConnected) {
                remoteControlServerBlocked = true
                disableRemoteInteractions(" Fale com o seu Consultor")
            } else {
                remoteControlServerBlocked = false
                updateRemoteControlAvailability()
            }
            return
        }
        if (transport != "websocket") return
        if (state == "connected") {
            operatorConnected = true
            update(this.state.copy(
                screen = SessionScreen.CONNECTED,
                status = "Atendente conectado. Iniciando o compartilhamento autorizado.",
                canShare = true,
                error = null
            ))
            updateRemoteControlAvailability()
            val resultCode = pendingProjectionResultCode
            val permissionData = pendingProjectionData
            if (resultCode != null && permissionData != null) {
                pendingProjectionResultCode = null
                pendingProjectionData = null
                startScreenShare(resultCode, permissionData)
            }
        } else if (state == "disconnected" && operatorConnected) {
            operatorWebrtcConnected = false
            terminate(
                "A conexão com o atendente foi interrompida. A transmissão foi encerrada.",
                error = "Conexão WebSocket perdida; digite EUQUERO novamente para tentar reconectar."
            )
        }
    }

    override fun onRemoteControlState(available: Boolean) {
        if (!available) {
            remoteControlServerBlocked = true
            disableRemoteInteractions("As interações foram desativadas pelo servidor.")
        }
    }

    override fun onRemoteControlCommand(command: RemoteControlCommand) {
        if (
            !remoteControlAvailable ||
            !canControlNow()
        ) {
            signalingClient?.sendRemoteControlResult(command, "failed", "command_cancelled")
            return
        }
        synchronized(seenRemoteCommandIds) {
            if (!seenRemoteCommandIds.add(command.commandId)) {
                signalingClient?.sendRemoteControlResult(command, "failed", "command_cancelled")
                return
            }
            if (seenRemoteCommandIds.size > 2_000) {
                seenRemoteCommandIds.remove(seenRemoteCommandIds.first())
            }
        }
        val dispatched = RemoteControlAccessibilityService.execute(command) { errorCode ->
            signalingClient?.sendRemoteControlResult(
                command,
                if (errorCode == null) "succeeded" else "failed",
                errorCode
            )
        }
        if (!dispatched) {
            signalingClient?.sendRemoteControlResult(command, "failed", "accessibility_disabled")
        }
    }

    override fun onRemoteControlFailure(message: String) {
        update(state.copy(
            remoteInteractionStatus = message,
            remoteInteractionAvailable = false
        ))
        clearRemoteControlState()
    }

    override fun onSessionEnded(reason: String) {
        terminate(
            if (reason == "consent_revoked") {
                "Consentimento revogado. A transmissão foi interrompida."
            } else {
                "O atendimento terminou. A transmissão foi interrompida."
            },
            error = null
        )
    }

    override fun onFailure(message: String) {
        terminate(message, error = message)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> cancelSession()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        Log.i(TAG, "Service destroyed (sharing=$isSharing, webrtc=${state.webrtcState})")
        sessionGeneration.incrementAndGet()
        terminal.set(true)
        clearRemoteControlState()
        RemoteControlAccessibilityService.setAuthorizationLostListener(null)
        val activePublisher = publisher
        publisher = null
        activePublisher?.close()
        signalingClient?.disconnect()
        signalingClient = null
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun terminate(message: String, error: String?) {
        if (!terminal.compareAndSet(false, true)) return
        pendingKeyword = ""
        pendingProjectionResultCode = null
        pendingProjectionData = null
        Log.w(TAG, "Ending session (sharing=$isSharing, webrtc=${state.webrtcState})")
        sessionGeneration.incrementAndGet()
        isSharing = false
        webrtcConnected = false
        sessionJoined = false
        clearRemoteControlState()
        val activePublisher = publisher
        publisher = null
        val activeSignaling = signalingClient
        signalingClient = null
        serviceScope.launch {
            activePublisher?.close()
            activeSignaling?.disconnect()
        }
        mainHandler.post {
            stopForegroundCompat()
            update(SessionUiState(
                screen = SessionScreen.ENDED,
                status = message,
                sessionId = state.sessionId,
                publicCode = state.publicCode,
                clientName = state.clientName,
                webrtcState = "closed",
                error = error,
                canShare = false
            ))
            stopSelf()
        }
    }

    private fun update(value: SessionUiState) {
        state = value
        emit(value)
    }

    private fun showConnectionSetupError(generation: Long, status: String, error: String) {
        if (!isCurrent(generation)) return
        terminal.set(true)
        pendingKeyword = ""
        sessionJoined = false
        operatorConnected = false
        iceServers = emptyList()
        update(SessionUiState(
            screen = SessionScreen.HOME,
            status = status,
            sessionId = state.sessionId,
            publicCode = state.publicCode,
            clientName = state.clientName,
            error = error
        ))
        stopSelf()
    }

    private fun emit(value: SessionUiState) {
        mainHandler.post { listener?.onStateChanged(value) }
    }

    private fun isCurrent(generation: Long): Boolean =
        sessionGeneration.get() == generation && !terminal.get()

    private fun canControlNow(): Boolean =
        sessionJoined &&
            operatorConnected &&
            operatorWebrtcConnected &&
            isSharing &&
            webrtcConnected &&
            !remoteControlServerBlocked &&
            !terminal.get()

    private fun clearRemoteControlState() {
        val wasAvailable = remoteControlAvailable
        RemoteControlAccessibilityService.setControlAuthorized(false)
        remoteControlAvailable = false
        remoteControlServerBlocked = false
        if (wasAvailable && sessionJoined && !terminal.get()) {
            signalingClient?.sendRemoteControlState(false)
        }
        synchronized(seenRemoteCommandIds) { seenRemoteCommandIds.clear() }
    }

    private fun updateRemoteControlAvailability() {
        val enabled = RemoteControlAccessibilityService.isEnabled(this)
        val available = enabled &&
            canControlNow() &&
            RemoteControlAccessibilityService.setControlAuthorized(true)
        if (!available) RemoteControlAccessibilityService.setControlAuthorized(false)
        if (available != remoteControlAvailable) {
            remoteControlAvailable = available
            if (sessionJoined && !terminal.get()) signalingClient?.sendRemoteControlState(available)
        }
        val status = when {
            available -> ""
            !enabled -> " "
            !isSharing -> " "
            !webrtcConnected || !operatorWebrtcConnected -> " "
            else -> "Interações indisponíveis nesta sessão."
        }
        update(state.copy(
            accessibilityEnabled = enabled,
            remoteInteractionAvailable = available,
            remoteInteractionStatus = status
        ))
    }

    private fun disableRemoteInteractions(message: String) {
        val wasAvailable = remoteControlAvailable
        RemoteControlAccessibilityService.setControlAuthorized(false)
        remoteControlAvailable = false
        if (wasAvailable && sessionJoined && !terminal.get()) {
            signalingClient?.sendRemoteControlState(false)
        }
        update(state.copy(
            accessibilityEnabled = RemoteControlAccessibilityService.isEnabled(this),
            remoteInteractionAvailable = false,
            remoteInteractionStatus = message
        ))
    }

    private fun listenerFor(generation: Long) = object : DeviceSignalingClient.Listener {
        override fun onJoined(iceServers: List<IceServerConfig>) {
            if (isCurrent(generation)) this@HelpConnectService.onJoined(iceServers)
        }

        override fun onDescription(type: String, sdp: String) {
            if (isCurrent(generation)) this@HelpConnectService.onDescription(type, sdp)
        }

        override fun onIceCandidate(candidate: RemoteIceCandidate?) {
            if (isCurrent(generation)) this@HelpConnectService.onIceCandidate(candidate)
        }

        override fun onPeerState(transport: String, participant: String?, state: String) {
            if (isCurrent(generation)) this@HelpConnectService.onPeerState(transport, participant, state)
        }

        override fun onRemoteControlState(available: Boolean) {
            if (isCurrent(generation)) this@HelpConnectService.onRemoteControlState(available)
        }

        override fun onRemoteControlCommand(command: RemoteControlCommand) {
            if (isCurrent(generation)) this@HelpConnectService.onRemoteControlCommand(command)
        }

        override fun onRemoteControlFailure(message: String) {
            if (isCurrent(generation)) this@HelpConnectService.onRemoteControlFailure(message)
        }

        override fun onSessionEnded(reason: String) {
            if (isCurrent(generation)) this@HelpConnectService.onSessionEnded(reason)
        }

        override fun onFailure(message: String) {
            if (isCurrent(generation)) this@HelpConnectService.onFailure(message)
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notificationsVisible(): Boolean {
        val manager = getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return false
        val channel = manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID)
        if (channel == null || channel.importance == NotificationManager.IMPORTANCE_NONE) return false
        return true
    }

    private fun buildSharingNotification(): Notification {
        val activityIntent = Intent(this, MainActivity::class.java)
        val contentIntent = PendingIntent.getActivity(
            this,
            0,
            activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, HelpConnectService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
        val stopAction = Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(this, R.drawable.ic_helpconnect),
            getString(R.string.notification_stop),
            stopIntent
        ).build()
        builder
            .setSmallIcon(R.drawable.ic_helpconnect)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText("Toque para voltar ao HelpConnect ou interrompa a transmissão.")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .addAction(stopAction)
        return builder.build()
    }

    private fun stopForegroundCompat() {
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    companion object {
        private const val TAG = "HelpConnectService"
        private const val ACTION_STOP = "com.helpconnect.android.STOP_SHARING"
        private const val NOTIFICATION_CHANNEL_ID = "screen_sharing"
        private const val NOTIFICATION_ID = 1001
    }
}
