package com.helpconnect.android.presentation

import android.Manifest
import android.media.projection.MediaProjectionManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.helpconnect.android.BuildConfig
import com.helpconnect.android.R
import com.helpconnect.android.projection.ProjectionConsent
import com.helpconnect.android.service.HelpConnectService
import com.helpconnect.android.service.SessionScreen
import com.helpconnect.android.service.SessionUiState

class MainActivity : AppCompatActivity(), HelpConnectService.StateListener {
    private var service: HelpConnectService? = null
    private var bound = false
    private lateinit var codeInput: TextInputEditText
    private lateinit var ticketInput: TextInputEditText
    private lateinit var statusText: TextView
    private lateinit var errorText: TextView
    private lateinit var sessionCard: MaterialCardView
    private lateinit var endedCard: MaterialCardView
    private lateinit var homeCard: MaterialCardView
    private lateinit var sessionForm: LinearLayout
    private lateinit var startSessionButton: MaterialButton
    private lateinit var sessionCodeText: TextView
    private lateinit var sessionStatusText: TextView
    private lateinit var sharingConsentText: TextView
    private lateinit var remoteInteractionHelpText: TextView
    private lateinit var webrtcStateText: TextView
    private lateinit var remoteInteractionStatusText: TextView
    private lateinit var endedStatusText: TextView
    private lateinit var startSharingButton: MaterialButton
    private lateinit var stopSharingButton: MaterialButton
    private lateinit var accessibilitySettingsButton: MaterialButton
    private var currentState = SessionUiState()
    private var showingSessionForm = false

    private val projectionRequest = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
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
        setContentView(createContent())
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

    private fun createContent(): View {
        val scroll = ScrollView(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(28), dp(24), dp(32))
        }
        scroll.addView(column)

        column.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 30f
            setTextColor(0xFF175CD3.toInt())
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, matchWidth())
        column.addView(TextView(this).apply {
            text = getString(R.string.app_tagline)
            textSize = 16f
            setPadding(0, dp(4), 0, dp(20))
        }, matchWidth())

        val homeColumn = cardColumn()
        startSessionButton = MaterialButton(this).apply {
            text = getString(R.string.start_session_title)
            setOnClickListener {
                showingSessionForm = true
                render(currentState)
            }
        }
        homeColumn.addView(startSessionButton, matchWidth())

        sessionForm = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        sessionForm.addView(TextView(this).apply {
            text = getString(R.string.session_input_help)
            textSize = 14f
            setPadding(0, 0, 0, dp(16))
        }, matchWidth())
        val (codeLayout, codeEditText) = textInput(
            getString(R.string.session_code_hint),
            getString(R.string.session_code_placeholder),
            false
        )
        codeInput = codeEditText
        sessionForm.addView(codeLayout, matchWidth())
        val (ticketLayout, ticketEditText) = textInput(
            getString(R.string.device_ticket_hint),
            getString(R.string.device_ticket_placeholder),
            true
        )
        ticketInput = ticketEditText
        sessionForm.addView(ticketLayout, margins(top = 12))
        val connectButton = MaterialButton(this).apply {
            text = getString(R.string.validate_and_connect)
            setOnClickListener {
                hideKeyboard()
                val code = codeInput.text?.toString().orEmpty()
                val ticket = ticketInput.text?.toString().orEmpty()
                if (!BuildConfig.DEBUG && !BuildConfig.API_BASE_URL.startsWith("https://")) {
                    showError("A configuração de produção exige uma URL HTTPS.")
                    return@setOnClickListener
                }
                service?.connect(code, ticket) ?: showError("O serviço do aplicativo ainda está iniciando.")
                ticketInput.text?.clear()
            }
        }
        sessionForm.addView(connectButton, margins(top = 12))
        statusText = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(12), 0, 0)
        }
        sessionForm.addView(statusText, matchWidth())
        errorText = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFB42318.toInt())
            setPadding(0, dp(8), 0, 0)
            visibility = View.GONE
        }
        sessionForm.addView(errorText, matchWidth())
        homeColumn.addView(sessionForm, margins(top = 16))
        homeCard = card(homeColumn)
        column.addView(homeCard, margins(bottom = 16))

        val sessionColumn = cardColumn()
        sessionCodeText = TextView(this).apply {
            textSize = 16f
            setPadding(0, 0, 0, dp(8))
        }
        sessionStatusText = TextView(this).apply {
            textSize = 14f
        }
        sessionColumn.addView(sessionCodeText, matchWidth())
        sessionColumn.addView(sessionStatusText, margins(bottom = 12))
        sharingConsentText = TextView(this).apply {
            text = getString(R.string.screen_sharing_consent_help)
            textSize = 14f
            setPadding(0, 0, 0, dp(12))
        }
        sessionColumn.addView(sharingConsentText, matchWidth())
        remoteInteractionHelpText = TextView(this).apply {
            text = getString(R.string.remote_interaction_help)
            textSize = 14f
            setPadding(0, 0, 0, dp(12))
        }
        sessionColumn.addView(remoteInteractionHelpText, matchWidth())
        remoteInteractionStatusText = TextView(this).apply {
            textSize = 14f
            setPadding(0, 0, 0, dp(12))
        }
        sessionColumn.addView(remoteInteractionStatusText, matchWidth())
        accessibilitySettingsButton = MaterialButton(this).apply {
            text = "Configurar acessibilidade"
            setOnClickListener {
                service?.showStatus("Ative HelpConnect manualmente nas Configurações de acessibilidade.")
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }
        sessionColumn.addView(accessibilitySettingsButton, margins(bottom = 8))
        startSharingButton = MaterialButton(this).apply {
            text = getString(R.string.allow_screen_sharing)
            setOnClickListener { requestNotificationPermissionOrProjection() }
        }
        sessionColumn.addView(startSharingButton, margins(bottom = 8))
        webrtcStateText = TextView(this).apply {
            textSize = 14f
            setPadding(0, 0, 0, dp(12))
        }
        sessionColumn.addView(webrtcStateText, matchWidth())
        stopSharingButton = MaterialButton(this).apply {
            text = getString(R.string.stop_screen_sharing)
            setOnClickListener { service?.stopScreenShare() }
        }
        sessionColumn.addView(stopSharingButton, margins(bottom = 8))
        sessionCard = card(sessionColumn).also { it.visibility = View.GONE }
        column.addView(sessionCard, margins(bottom = 16))

        val endedColumn = cardColumn()
        endedColumn.addView(TextView(this).apply {
            text = getString(R.string.session_ended_title)
            textSize = 20f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, matchWidth())
        endedStatusText = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(8), 0, dp(12))
        }
        endedColumn.addView(endedStatusText, matchWidth())
        endedColumn.addView(MaterialButton(this).apply {
            text = getString(R.string.return_home)
            setOnClickListener {
                codeInput.text?.clear()
                ticketInput.text?.clear()
                service?.reset()
                showingSessionForm = false
                render(SessionUiState())
            }
        }, matchWidth())
        endedCard = card(endedColumn).also { it.visibility = View.GONE }
        column.addView(endedCard, matchWidth())
        return scroll
    }

    private fun textInput(
        hint: String,
        placeholder: String,
        isTicket: Boolean
    ): Pair<TextInputLayout, TextInputEditText> {
        val layout = TextInputLayout(this).apply { this.hint = hint }
        val input = TextInputEditText(this).apply {
            this.hint = placeholder
            if (isTicket) {
                inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                isSingleLine = true
            } else {
                inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                isSingleLine = true
            }
        }
        layout.addView(input)
        return layout to input
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
        if (!::statusText.isInitialized) return
        statusText.text = state.status
        sessionCodeText.text = getString(R.string.session_code_format, state.publicCode)
        sessionStatusText.text = listOfNotNull(state.status, state.error).joinToString("\n")
        remoteInteractionStatusText.text = state.remoteInteractionStatus
        endedStatusText.text = listOfNotNull(
            state.status,
            state.error,
            "A transmissão foi interrompida."
        ).filter(String::isNotBlank).distinct().joinToString("\n\n")
        if (state.error.isNullOrBlank()) {
            errorText.visibility = View.GONE
        } else {
            errorText.text = state.error
            errorText.visibility = View.VISIBLE
        }
        homeCard.visibility = if (state.screen == SessionScreen.HOME) View.VISIBLE else View.GONE
        startSessionButton.visibility =
            if (state.screen == SessionScreen.HOME && !showingSessionForm) View.VISIBLE else View.GONE
        sessionForm.visibility =
            if (state.screen == SessionScreen.HOME && showingSessionForm) View.VISIBLE else View.GONE
        val activeSession = state.screen == SessionScreen.CONNECTING ||
            state.screen == SessionScreen.CONNECTED ||
            state.screen == SessionScreen.SHARING
        sessionCard.visibility = if (activeSession) View.VISIBLE else View.GONE
        val consentVisible = state.screen == SessionScreen.CONNECTED || state.screen == SessionScreen.SHARING
        sharingConsentText.visibility = if (consentVisible) View.VISIBLE else View.GONE
        remoteInteractionHelpText.visibility = if (consentVisible) View.VISIBLE else View.GONE
        remoteInteractionStatusText.visibility = if (consentVisible) View.VISIBLE else View.GONE
        accessibilitySettingsButton.visibility =
            if (consentVisible && !state.accessibilityEnabled) View.VISIBLE else View.GONE
        startSharingButton.visibility = if (state.screen == SessionScreen.CONNECTED) View.VISIBLE else View.GONE
        endedCard.visibility = if (state.screen == SessionScreen.ENDED) View.VISIBLE else View.GONE
        startSharingButton.isEnabled = state.screen == SessionScreen.CONNECTED && state.canShare
        webrtcStateText.text = getString(R.string.webrtc_state_format, state.webrtcState)
        webrtcStateText.visibility = if (state.screen == SessionScreen.SHARING) View.VISIBLE else View.GONE
        stopSharingButton.visibility = if (state.screen == SessionScreen.SHARING) View.VISIBLE else View.GONE
    }

    private fun showError(message: String) {
        if (!::errorText.isInitialized) return
        errorText.text = message
        errorText.visibility = View.VISIBLE
    }

    private fun hideKeyboard() {
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(currentFocus?.windowToken, 0)
    }

    private fun cardColumn() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(18), dp(18), dp(18))
    }

    private fun card(content: View) = MaterialCardView(this).apply {
        radius = dp(16).toFloat()
        cardElevation = dp(2).toFloat()
        addView(content)
    }

    private fun matchWidth() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
    )

    private fun margins(top: Int = 0, bottom: Int = 0) = matchWidth().apply {
        topMargin = dp(top)
        bottomMargin = dp(bottom)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
