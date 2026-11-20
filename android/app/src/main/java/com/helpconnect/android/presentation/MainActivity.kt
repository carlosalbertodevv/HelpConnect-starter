package com.helpconnect.android.presentation

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.provider.Settings
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.helpconnect.android.BuildConfig
import com.helpconnect.android.R
import com.helpconnect.android.projection.ProjectionConsent
import com.helpconnect.android.service.HelpConnectService
import com.helpconnect.android.service.SessionScreen
import com.helpconnect.android.service.SessionUiState

class MainActivity : AppCompatActivity(), HelpConnectService.StateListener {
    private var service: HelpConnectService? = null
    private var bound = false
    private var currentState = SessionUiState()

    private lateinit var keywordInput: TextInputEditText
    private lateinit var connectionForm: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var errorText: TextView
    private lateinit var pairingCodeText: TextView
    private lateinit var sessionPanel: LinearLayout
    private lateinit var sessionIdentityText: TextView
    private lateinit var sessionStatusText: TextView
    private lateinit var remoteInteractionStatusText: TextView
    private lateinit var webrtcStateText: TextView
    private lateinit var endedPanel: LinearLayout
    private lateinit var endedStatusText: TextView
    private lateinit var confirmSessionButton: MaterialButton
    private lateinit var startSharingButton: MaterialButton
    private lateinit var stopSharingButton: MaterialButton
    private lateinit var accessibilitySettingsButton: MaterialButton
    private lateinit var connectButton: MaterialButton

    private val projectionRequest =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val grant = ProjectionConsent.accept(result.resultCode, result.data)
            if (grant != null) {
                service?.startScreenShare(grant.resultCode, grant.permissionData)
            } else {
                service?.showStatus("Autorização de captura cancelada. Nenhuma tela foi compartilhada.")
            }
        }

    private val notificationPermissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) requestProjectionPermission()
            else service?.showStatus("Ative notificações para manter o indicador visível durante o compartilhamento.")
        }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            val localBinder = binder as? HelpConnectService.LocalBinder ?: return
            service = localBinder.service().also { it.setStateListener(this@MainActivity) }
            onStateChanged(service?.currentState() ?: SessionUiState())
            service?.refreshAccessibilityStatus()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            service?.setStateListener(null)
            service = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setupFormLayout()
        render(currentState)
    }

    override fun onStart() {
        super.onStart()
        bound = bindService(Intent(this, HelpConnectService::class.java), serviceConnection, Context.BIND_AUTO_CREATE)
    }

    override fun onStop() {
        service?.setStateListener(null)
        if (bound) unbindService(serviceConnection)
        bound = false
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        service?.refreshAccessibilityStatus()
    }

    override fun onStateChanged(state: SessionUiState) {
        currentState = state
        render(state)
    }

    private fun setupFormLayout() {
        val root = layoutInflater.inflate(R.layout.activity_main_form, null) as LinearLayout
        setContentView(root)
        connectionForm = root.findViewById(R.id.connection_form)
        keywordInput = root.findViewById(R.id.keyword_input)
        statusText = root.findViewById(R.id.status_text)
        errorText = root.findViewById(R.id.error_text)
        pairingCodeText = root.findViewById(R.id.pairing_code)
        sessionPanel = root.findViewById(R.id.session_panel)
        sessionIdentityText = root.findViewById(R.id.session_identity)
        sessionStatusText = root.findViewById(R.id.session_status)
        remoteInteractionStatusText = root.findViewById(R.id.remote_interaction_status)
        webrtcStateText = root.findViewById(R.id.webrtc_state)
        endedPanel = root.findViewById(R.id.ended_panel)
        endedStatusText = root.findViewById(R.id.ended_status)
        connectButton = root.findViewById(R.id.connect_button)
        confirmSessionButton = root.findViewById(R.id.confirm_session_button)
        startSharingButton = root.findViewById(R.id.start_sharing_button)
        stopSharingButton = root.findViewById(R.id.stop_sharing_button)
        accessibilitySettingsButton = root.findViewById(R.id.accessibility_settings_button)

        connectButton.setOnClickListener {
            hideKeyboard()
            if (!BuildConfig.DEBUG && !BuildConfig.API_BASE_URL.startsWith("https://")) {
                showError("A configuração de produção exige uma URL HTTPS.")
                return@setOnClickListener
            }
            service?.connect(keywordInput.text?.toString().orEmpty())
                ?: showError("O serviço do aplicativo ainda está iniciando.")
            keywordInput.text?.clear()
        }
        keywordInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                connectButton.performClick()
                true
            } else {
                false
            }
        }
        confirmSessionButton.setOnClickListener { confirmSessionBeforeConsent() }
        startSharingButton.setOnClickListener { requestNotificationPermissionOrProjection() }
        stopSharingButton.setOnClickListener { service?.stopScreenShare() }
        accessibilitySettingsButton.setOnClickListener {
            service?.showStatus("Ative HelpConnect manualmente nas Configurações de acessibilidade.")
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        root.findViewById<MaterialButton>(R.id.return_home_button).setOnClickListener {
            service?.reset()
        }
    }

    private fun confirmSessionBeforeConsent() {
        val clientName = currentState.clientName?.takeIf(String::isNotBlank) ?: "Não informado"
        AlertDialog.Builder(this)
            .setTitle(R.string.confirm_session_title)
            .setMessage(getString(
                R.string.confirm_session_message,
                clientName,
                currentState.publicCode
            ))
            .setNegativeButton(android.R.string.cancel) { _, _ ->
                service?.cancelSessionConfirmation()
            }
            .setPositiveButton(R.string.confirm_session_continue) { _, _ ->
                service?.confirmSession()
                requestNotificationPermissionOrProjection()
            }
            .show()
    }

    private fun requestNotificationPermissionOrProjection() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            requestProjectionPermission()
        }
    }

    private fun requestProjectionPermission() {
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionRequest.launch(ProjectionConsent.createRequest(manager))
    }

    private fun render(state: SessionUiState) {
        val awaitingConfirmation = state.screen == SessionScreen.AWAITING_CONFIRMATION
        val activeSession = awaitingConfirmation ||
            state.screen == SessionScreen.CONNECTING ||
            state.screen == SessionScreen.CONNECTED ||
            state.screen == SessionScreen.SHARING
        connectionForm.visibility = if (state.screen == SessionScreen.HOME) View.VISIBLE else View.GONE
        sessionPanel.visibility = if (activeSession) View.VISIBLE else View.GONE
        endedPanel.visibility = if (state.screen == SessionScreen.ENDED) View.VISIBLE else View.GONE
        statusText.text = state.status
        if (state.error.isNullOrBlank()) {
            errorText.visibility = View.GONE
        } else {
            errorText.text = state.error
            errorText.visibility = View.VISIBLE
        }
        pairingCodeText.visibility = if (state.pairingCode == null) View.GONE else View.VISIBLE
        pairingCodeText.text = state.pairingCode?.let { getString(R.string.pairing_code_format, it) }.orEmpty()
        sessionIdentityText.text = "Cliente: ${state.clientName?.takeIf(String::isNotBlank) ?: "Não informado"}\n" +
            getString(R.string.session_code_format, state.publicCode)
        sessionStatusText.text = listOfNotNull(state.status, state.error)
            .filter(String::isNotBlank)
            .distinct()
            .joinToString("\n")
        confirmSessionButton.visibility = if (awaitingConfirmation) View.VISIBLE else View.GONE
        remoteInteractionStatusText.text = state.remoteInteractionStatus
        accessibilitySettingsButton.visibility =
            if (activeSession && !state.accessibilityEnabled) View.VISIBLE else View.GONE
        startSharingButton.visibility = View.GONE
        webrtcStateText.text = getString(R.string.webrtc_state_format, state.webrtcState)
        webrtcStateText.visibility = if (state.screen == SessionScreen.SHARING) View.VISIBLE else View.GONE
        stopSharingButton.visibility = if (state.screen == SessionScreen.SHARING) View.VISIBLE else View.GONE
        endedStatusText.text = listOfNotNull(state.status, state.error, "A transmissão foi interrompida.")
            .filter(String::isNotBlank)
            .distinct()
            .joinToString("\n\n")
    }

    private fun showError(message: String) {
        errorText.text = message
        errorText.visibility = View.VISIBLE
    }

    private fun hideKeyboard() {
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(currentFocus?.windowToken, 0)
    }
}
