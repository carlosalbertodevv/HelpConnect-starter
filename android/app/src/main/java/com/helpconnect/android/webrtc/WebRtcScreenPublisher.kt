package com.helpconnect.android.webrtc

import android.content.Context
import android.content.Intent
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import com.helpconnect.android.signaling.IceServerConfig
import com.helpconnect.android.signaling.RemoteIceCandidate
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

class WebRtcScreenPublisher(
    private val context: Context,
    private val onLocalDescription: (String, String) -> Unit,
    private val onLocalCandidate: (IceCandidate?) -> Unit,
    private val onCaptureStarted: () -> Unit,
    private val onConnectionState: (String) -> Unit,
    private val onProjectionStopped: () -> Unit,
    private val onFailure: (String) -> Unit
) {
    private val releaseGuard = ReleaseGuard()
    private val disposed = AtomicBoolean(false)
    private val pendingCandidates = CopyOnWriteArrayList<IceCandidate>()
    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    @Volatile private var hasRemoteDescription = false

    fun start(permissionData: Intent, iceServerConfigs: List<IceServerConfig>) {
        check(!disposed.get()) { "Screen publisher is closed." }
        try {
            initializeFactory()
            eglBase = EglBase.create()
            val eglContext = checkNotNull(eglBase).eglBaseContext
            val peerFactory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglContext))
                .createPeerConnectionFactory()
            factory = peerFactory

            val iceServers = iceServerConfigs.flatMap { config ->
                config.urls.map { url ->
                    val builder = PeerConnection.IceServer.builder(url)
                    config.username?.let(builder::setUsername)
                    config.credential?.let(builder::setPassword)
                    builder.createIceServer()
                }
            }
            val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            }
            peerConnection = peerFactory.createPeerConnection(rtcConfig, createObserver())
                ?: throw IllegalStateException("WebRTC could not create a peer connection.")

            val screenCapturer = ScreenCapturerAndroid(
                permissionData,
                object : android.media.projection.MediaProjection.Callback() {
                    override fun onStop() {
                        if (!disposed.get()) {
                            Log.w(TAG, "MediaProjection callback reported stop")
                            onProjectionStopped()
                        }
                    }
                }
            )
            capturer = screenCapturer
            val source = peerFactory.createVideoSource(screenCapturer.isScreencast)
            videoSource = source
            surfaceTextureHelper = SurfaceTextureHelper.create("HelpConnectScreenCapture", eglContext)
                ?: throw IllegalStateException("WebRTC could not initialize screen capture.")
            screenCapturer.initialize(
                surfaceTextureHelper,
                context.applicationContext,
                source.capturerObserver
            )
            val metrics = displayMetrics()
            val (width, height) = captureSize(metrics.widthPixels, metrics.heightPixels)
            Log.i(TAG, "Starting screen capture at ${width}x$height")
            screenCapturer.startCapture(width, height, 15)
            onCaptureStarted()

            val track = peerFactory.createVideoTrack("helpconnect-screen", source)
            videoTrack = track
            track.setEnabled(true)
            checkNotNull(peerConnection).addTrack(track, listOf("helpconnect-screen"))
            createOffer()
        } catch (error: Exception) {
            Log.e(TAG, "Unable to start screen capture or WebRTC publishing", error)
            onFailure("Não foi possível iniciar a captura WebRTC.")
            close()
        }
    }

    fun onRemoteDescription(type: String, sdp: String) {
        val peer = peerConnection ?: return
        if (disposed.get()) return
        val descriptionType = when (type) {
            "offer" -> SessionDescription.Type.OFFER
            "answer" -> SessionDescription.Type.ANSWER
            else -> {
                onFailure("Tipo de descrição SDP não suportado.")
                return
            }
        }
        peer.setRemoteDescription(object : SdpObserver {
            override fun onSetSuccess() {
                hasRemoteDescription = true
                flushCandidates(peer)
                if (descriptionType == SessionDescription.Type.OFFER) createAnswer(peer)
            }

            override fun onSetFailure(error: String?) {
                Log.e(TAG, "Failed to apply remote SDP description")
                onFailure("Não foi possível processar a descrição SDP remota.")
            }

            override fun onCreateSuccess(description: SessionDescription?) = Unit
            override fun onCreateFailure(error: String?) = Unit
        }, SessionDescription(descriptionType, sdp))
    }

    fun onRemoteIceCandidate(candidate: RemoteIceCandidate?) {
        if (candidate == null || disposed.get()) return
        val ice = IceCandidate(candidate.sdpMid, candidate.sdpMLineIndex ?: 0, candidate.candidate)
        val peer = peerConnection ?: return
        if (!hasRemoteDescription) {
            pendingCandidates.add(ice)
        } else if (!peer.addIceCandidate(ice)) {
            onFailure("Não foi possível adicionar um candidate ICE remoto.")
        }
    }

    fun close() {
        releaseGuard.release {
            disposed.set(true)
            try {
                capturer?.stopCapture()
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (_: Exception) {
                onFailure("A captura de tela não pôde ser encerrada corretamente.")
            }
            peerConnection?.close()
            peerConnection?.dispose()
            peerConnection = null
            videoTrack?.dispose()
            videoTrack = null
            videoSource?.dispose()
            videoSource = null
            capturer?.dispose()
            capturer = null
            surfaceTextureHelper?.dispose()
            surfaceTextureHelper = null
            factory?.dispose()
            factory = null
            eglBase?.release()
            eglBase = null
            pendingCandidates.clear()
        }
    }

    private fun createOffer() {
        val peer = checkNotNull(peerConnection)
        peer.createOffer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription?) {
                if (description == null) {
                    onFailure("O WebRTC retornou uma oferta SDP vazia.")
                    return
                }
                peer.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        onLocalDescription(description.type.canonicalForm(), description.description)
                    }

                    override fun onSetFailure(error: String?) {
                        Log.e(TAG, "Failed to set local SDP offer")
                        onFailure("Não foi possível definir a oferta SDP local.")
                    }

                    override fun onCreateSuccess(description: SessionDescription?) = Unit
                    override fun onCreateFailure(error: String?) = Unit
                }, description)
            }

            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "Failed to create local SDP offer")
                onFailure("Não foi possível criar a oferta WebRTC.")
            }

            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String?) = Unit
        }, MediaConstraints())
    }

    private fun createAnswer(peer: PeerConnection) {
        peer.createAnswer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription?) {
                if (description == null) {
                    onFailure("O WebRTC retornou uma resposta SDP vazia.")
                    return
                }
                peer.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        onLocalDescription(description.type.canonicalForm(), description.description)
                    }

                    override fun onSetFailure(error: String?) {
                        Log.e(TAG, "Failed to set local SDP answer")
                        onFailure("Não foi possível definir a resposta SDP local.")
                    }

                    override fun onCreateSuccess(description: SessionDescription?) = Unit
                    override fun onCreateFailure(error: String?) = Unit
                }, description)
            }

            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "Failed to create local SDP answer")
                onFailure("Não foi possível responder à oferta WebRTC.")
            }

            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String?) = Unit
        }, MediaConstraints())
    }

    private fun createObserver(): PeerConnection.Observer = object : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            state?.let { Log.i(TAG, "ICE connection state: ${it.name.lowercase()}") }
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
            if (state == PeerConnection.IceGatheringState.COMPLETE && !disposed.get()) {
                onLocalCandidate(null)
            }
        }
        override fun onIceCandidate(candidate: IceCandidate?) {
            if (!disposed.get() && candidate != null) onLocalCandidate(candidate)
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
        override fun onAddStream(stream: org.webrtc.MediaStream?) = Unit
        override fun onRemoveStream(stream: org.webrtc.MediaStream?) = Unit
        override fun onDataChannel(channel: org.webrtc.DataChannel?) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: org.webrtc.RtpReceiver?, streams: Array<out org.webrtc.MediaStream>?) = Unit
        override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) = Unit
        override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
            state?.let {
                Log.i(TAG, "Peer connection state: ${it.name.lowercase()}")
                onConnectionState(it.name.lowercase())
            }
        }
    }

    private fun flushCandidates(peer: PeerConnection) {
        while (pendingCandidates.isNotEmpty()) {
            val candidate = pendingCandidates.removeAt(0)
            if (!peer.addIceCandidate(candidate)) {
                onFailure("Não foi possível adicionar um candidate ICE remoto.")
            }
        }
    }

    private fun displayMetrics(): DisplayMetrics {
        val manager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return DisplayMetrics().also { metrics ->
            @Suppress("DEPRECATION")
            manager.defaultDisplay.getRealMetrics(metrics)
        }
    }

    private fun captureSize(width: Int, height: Int): Pair<Int, Int> {
        require(width > 0 && height > 0) { "Screen dimensions are unavailable." }
        val maxDimension = 1280
        val scale = minOf(1f, maxDimension.toFloat() / maxOf(width, height))
        val scaledWidth = ((width * scale).toInt().coerceAtLeast(2) / 2) * 2
        val scaledHeight = ((height * scale).toInt().coerceAtLeast(2) / 2) * 2
        return scaledWidth to scaledHeight
    }

    private fun initializeFactory() {
        synchronized(PeerConnectionFactory::class.java) {
            if (!factoryInitialized) {
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                        .createInitializationOptions()
                )
                factoryInitialized = true
            }
        }
    }

    companion object {
        private const val TAG = "WebRtcScreenPublisher"
        @Volatile private var factoryInitialized = false
    }
}
