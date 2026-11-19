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
import com.helpconnect.android.BuildConfig
import com.helpconnect.android.R
import com.helpconnect.android.data.DeviceApi
import com.helpconnect.android.domain.SessionInput
import com.helpconnect.android.presentation.MainActivity
import com.helpconnect.android.signaling.DeviceSignalingClient
import com.helpconnect.android.signaling.IceServerConfig
import com.helpconnect.android.signaling.RemoteIceCandidate
import com.helpconnect.android.webrtc.WebRtcScreenPublisher
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.content.Context
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

enum class SessionScreen {
    HOME,
    CONNECTING,
    CONNECTED,
    SHARING,
    ENDED
}

data class SessionUiState(
    val screen: SessionScreen = SessionScreen.HOME,
    val status: String = "Informe o código de atendimento e a credencial temporária.",
    val publicCode: String = "",
    val webrtcState: String = "aguardando",
    val error: String? = null,
    val canShare: Boolean = false
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
    @Volatile private var signalingClient: DeviceSignalingClient? = null
    @Volatile private var publisher: WebRtcScreenPublisher? = null
    @Volatile private var iceServers: List<IceServerConfig> = emptyList()
    @Volatile private var sessionJoined = false
    @Volatile private var isSharing = false
    @Volatile private var operatorConnected = false

    fun setStateListener(value: StateListener?) {
        listener = value
        value?.let { emit(state) }
    }

    fun currentState(): SessionUiState = state

    fun connect(publicCode: String, deviceToken: String) {
        if (state.screen != SessionScreen.HOME && state.screen != SessionScreen.ENDED) {
            update(state.copy(error = "Já existe um atendimento em andamento."))
            return
        }
        val normalizedCode = SessionInput.normalizeCode(publicCode)
        if (!SessionInput.isValidCode(normalizedCode)) {
            update(SessionUiState(error = "Informe um código HC válido."))
            return
        }
        if (!SessionInput.isValidTicket(deviceToken)) {
            update(SessionUiState(publicCode = normalizedCode, error = "Credencial temporária inválida."))
            return
        }

        val generation = sessionGeneration.incrementAndGet()
        terminal.set(false)
        sessionJoined = false
        operatorConnected = false
        iceServers = emptyList()
        update(SessionUiState(
            screen = SessionScreen.CONNECTING,
            status = "Validando sessão e credencial de uso único...",
            publicCode = normalizedCode
        ))
        startService(Intent(this@HelpConnectService, HelpConnectService::class.java))
        serviceScope.launch {
            try {
                val api = DeviceApi(BuildConfig.API_BASE_URL)
                val session = api.resolveSession(normalizedCode, deviceToken.trim())
                if (!isCurrent(generation)) return@launch
                val client = DeviceSignalingClient(api.websocketUrl(), listenerFor(generation))
                signalingClient = client
                update(SessionUiState(
                    screen = SessionScreen.CONNECTING,
                    status = "Conectando ao atendimento autorizado...",
                    publicCode = normalizedCode
                ))
                client.connect(session.sessionId, deviceToken.trim())
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (isCurrent(generation)) {
                    terminate(
                        "Não foi possível validar ou conectar. A credencial pode ter expirado ou sido consumida; solicite outra ao atendente.",
                        error = "Falha na validação da sessão ou na rede."
                    )
                }
            }
        }
    }

    fun startScreenShare(resultCode: Int, permissionData: Intent) {
        if (resultCode != Activity.RESULT_OK || !sessionJoined || !operatorConnected || terminal.get() || isSharing) {
            update(state.copy(error = "Conecte-se a uma sessão autorizada antes de compartilhar."))
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
            update(state.copy(error = "O Android não autorizou o serviço visível de captura."))
            return
        }
        if (!isCurrent(generation)) {
            stopForegroundCompat()
            return
        }

        isSharing = true
        update(state.copy(
            screen = SessionScreen.SHARING,
            status = "Preparando a transmissão de tela autorizada...",
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
                                status = "Captura autorizada; estabelecendo a conexão WebRTC.",
                                error = null
                            ))
                        }
                    },
                    onConnectionState = { connectionState ->
                        if (isCurrent(generation)) {
                            signalingClient?.sendConnectionState(connectionState)
                            if (connectionState == "failed") {
                                terminate(
                                    "A conexão WebRTC falhou. A captura foi interrompida.",
                                    error = "Falha na conexão WebRTC; solicite uma nova credencial antes de reconectar."
                                )
                            } else {
                                update(state.copy(
                                    screen = if (isSharing) SessionScreen.SHARING else SessionScreen.CONNECTED,
                                    status = when {
                                        !isSharing -> state.status
                                        connectionState == "connected" -> "Sua tela está conectada ao atendente e sendo transmitida."
                                        else -> "Captura autorizada; estado WebRTC: $connectionState."
                                    },
                                    webrtcState = connectionState
                                ))
                            }
                        }
                    },
                    onProjectionStopped = {
                        if (isCurrent(generation)) {
                            mainHandler.post {
                                stopScreenShare("A projeção foi encerrada pelo Android. Nenhum conteúdo continua sendo transmitido.")
                            }
                        }
                    },
                    onFailure = { message ->
                        if (isCurrent(generation)) terminate(message, error = message)
                    }
                )
                publisher = screenPublisher
                if (!isCurrent(generation)) {
                    screenPublisher.close()
                    return@launch
                }
                screenPublisher.start(permissionData, iceServers)
            } catch (_: Exception) {
                if (isCurrent(generation)) {
                    terminate("Não foi possível iniciar a captura WebRTC.", error = "Falha ao iniciar a captura.")
                }
            }
        }
    }

    fun stopScreenShare(message: String = "Compartilhamento interrompido. A sessão de sinalização permanece conectada.") {
        val generation = sessionGeneration.get()
        val activePublisher = publisher
        publisher = null
        isSharing = false
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
        operatorConnected = false
        sessionJoined = false
        iceServers = emptyList()
        update(SessionUiState())
    }

    override fun onJoined(iceServers: List<IceServerConfig>) {
        if (terminal.get()) return
        this.iceServers = iceServers
        sessionJoined = true
        update(state.copy(
            screen = SessionScreen.CONNECTED,
            status = "Sessão validada. Aguardando a conexão do atendente.",
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
        if (transport != "websocket" || participant != "operator") return
        if (state == "connected") {
            operatorConnected = true
            update(this.state.copy(
                screen = SessionScreen.CONNECTED,
                status = "Atendente conectado. A captura só começa após sua autorização explícita no Android.",
                canShare = true,
                error = null
            ))
        } else if (state == "disconnected" && operatorConnected) {
            terminate(
                "A conexão com o atendente foi interrompida. A transmissão foi encerrada.",
                error = "Conexão WebSocket perdida; uma nova credencial será necessária para reconectar."
            )
        }
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
        if (intent?.action == ACTION_STOP) {
            cancelSession()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onDestroy() {
        sessionGeneration.incrementAndGet()
        terminal.set(true)
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
        sessionGeneration.incrementAndGet()
        isSharing = false
        sessionJoined = false
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
                publicCode = state.publicCode,
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

    private fun emit(value: SessionUiState) {
        mainHandler.post { listener?.onStateChanged(value) }
    }

    private fun isCurrent(generation: Long): Boolean =
        sessionGeneration.get() == generation && !terminal.get()

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
        return builder
            .setSmallIcon(R.drawable.ic_helpconnect)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText("Toque para voltar ao HelpConnect ou interrompa a transmissão.")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .addAction(stopAction)
            .build()
    }

    private fun stopForegroundCompat() {
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    companion object {
        private const val ACTION_STOP = "com.helpconnect.android.STOP_SHARING"
        private const val NOTIFICATION_CHANNEL_ID = "screen_sharing"
        private const val NOTIFICATION_ID = 1001
    }
}
