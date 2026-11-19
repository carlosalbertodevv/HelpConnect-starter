package com.helpconnect.android.presentation

import android.Manifest
import android.app.Activity
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
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
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
    private lateinit var connectionCard: MaterialCardView
    private lateinit var sharingCard: MaterialCardView
    private lateinit var endedCard: MaterialCardView
    private lateinit var homeCard: MaterialCardView
    private lateinit var connectionCodeText: TextView
    private lateinit var connectionStepText: TextView
    private lateinit var webrtcStateText: TextView
    private lateinit var sharingStatusText: TextView
    private lateinit var endedStatusText: TextView
    private lateinit var startSharingButton: MaterialButton
    private var currentState = SessionUiState()

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
        homeColumn.addView(TextView(this).apply {
            text = getString(R.string.start_session_title)
            textSize = 20f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, matchWidth())
        homeColumn.addView(TextView(this).apply {
            text = getString(R.string.session_input_help)
            textSize = 14f
            setPadding(0, dp(8), 0, dp(16))
        }, matchWidth())
        codeInput = textInput(
            getString(R.string.session_code_hint),
            getString(R.string.session_code_placeholder),
            false
        )
        homeColumn.addView((codeInput.parent as View), matchWidth())
        ticketInput = textInput(
            getString(R.string.device_ticket_hint),
            getString(R.string.device_ticket_placeholder),
            true
        )
        homeColumn.addView((ticketInput.parent as View), margins(top = 12))
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
                if (BuildConfig.API_BASE_URL.contains("example.invalid")) {
                    showError("Configure helpconnectApiBaseUrl antes de conectar.")
                    return@setOnClickListener
                }
                service?.connect(code, ticket) ?: showError("O serviço do aplicativo ainda está iniciando.")
                ticketInput.text?.clear()
            }
        }
        homeColumn.addView(connectButton, margins(top = 12))
        statusText = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(12), 0, 0)
        }
        homeColumn.addView(statusText, matchWidth())
        errorText = TextView(this).apply {
            textSize = 14f
            setTextColor(0xFFB42318.toInt())
            setPadding(0, dp(8), 0, 0)
            visibility = View.GONE
        }
        homeColumn.addView(errorText, matchWidth())
        homeCard = card(homeColumn)
        column.addView(homeCard, margins(bottom = 16))

        val connectionColumn = cardColumn()
        connectionColumn.addView(TextView(this).apply {
            text = getString(R.string.secure_connection)
            textSize = 20f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, matchWidth())
        connectionCodeText = TextView(this).apply {
            textSize = 16f
            setPadding(0, dp(12), 0, dp(4))
        }
        connectionStepText = TextView(this).apply {
            textSize = 14f
        }
        connectionColumn.addView(connectionCodeText, matchWidth())
        connectionColumn.addView(connectionStepText, margins(bottom = 12))
        startSharingButton = MaterialButton(this).apply {
            text = getString(R.string.allow_screen_sharing)
            setOnClickListener { requestNotificationPermissionOrProjection() }
        }
        connectionColumn.addView(startSharingButton, margins(bottom = 8))
        connectionColumn.addView(MaterialButton(this).apply {
            text = getString(R.string.cancel_connection)
            setOnClickListener { service?.cancelSession() }
        }, matchWidth())
        connectionCard = card(connectionColumn).also { it.visibility = View.GONE }
        column.addView(connectionCard, margins(bottom = 16))

        val sharingColumn = cardColumn()
        sharingColumn.addView(TextView(this).apply {
            text = getString(R.string.screen_sharing_title)
            textSize = 20f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, matchWidth())
        sharingStatusText = TextView(this).apply {
            textSize = 14f
            setPadding(0, dp(8), 0, dp(12))
        }
        sharingColumn.addView(sharingStatusText, matchWidth())
        webrtcStateText = TextView(this).apply { textSize = 14f }
        sharingColumn.addView(webrtcStateText, margins(bottom = 12))
        val stopSharingButton = MaterialButton(this).apply {
            text = getString(R.string.stop_screen_sharing)
            setOnClickListener {
                service?.stopScreenShare()
            }
        }
        sharingColumn.addView(stopSharingButton, matchWidth())
        sharingCard = card(sharingColumn).also { it.visibility = View.GONE }
        column.addView(sharingCard, margins(bottom = 16))

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
                render(SessionUiState())
            }
        }, matchWidth())
        endedCard = card(endedColumn).also { it.visibility = View.GONE }
        column.addView(endedCard, matchWidth())
        return scroll
    }

    private fun textInput(hint: String, placeholder: String, isTicket: Boolean): TextInputEditText {
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
        return input
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
        connectionCodeText.text = getString(R.string.session_code_format, state.publicCode)
        connectionStepText.text = listOfNotNull(state.status, state.error).joinToString("\n")
        sharingStatusText.text = state.status
        endedStatusText.text = listOfNotNull(
            state.status,
            state.error,
            "A transmissão foi interrompida."
        ).filter(String::isNotBlank).distinct().joinToString("\n\n")
        webrtcStateText.text = getString(R.string.webrtc_state_format, state.webrtcState)
        if (state.error.isNullOrBlank()) {
            errorText.visibility = View.GONE
        } else {
            errorText.text = state.error
            errorText.visibility = View.VISIBLE
        }
        homeCard.visibility = if (state.screen == SessionScreen.HOME) View.VISIBLE else View.GONE
        connectionCard.visibility = if (state.screen == SessionScreen.CONNECTING || state.screen == SessionScreen.CONNECTED) View.VISIBLE else View.GONE
        sharingCard.visibility = if (state.screen == SessionScreen.SHARING) View.VISIBLE else View.GONE
        endedCard.visibility = if (state.screen == SessionScreen.ENDED) View.VISIBLE else View.GONE
        startSharingButton.isEnabled = state.screen == SessionScreen.CONNECTED && state.canShare
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
