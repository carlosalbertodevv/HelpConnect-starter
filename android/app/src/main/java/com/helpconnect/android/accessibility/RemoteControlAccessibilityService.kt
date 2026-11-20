package com.helpconnect.android.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.provider.Settings
import android.app.KeyguardManager
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.helpconnect.android.signaling.RemoteControlAction
import com.helpconnect.android.signaling.RemoteControlCommand

class RemoteControlAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        val previouslyAuthorized = synchronized(stateLock) {
            val wasAuthorized = controlAuthorized
            activeService = this
            controlAuthorized = false
            wasAuthorized
        }
        if (previouslyAuthorized) authorizationLostListener?.invoke()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() {
        invalidateAuthorization()
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        invalidateAuthorization()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        invalidateAuthorization()
        super.onDestroy()
    }

    private fun invalidateAuthorization() {
        val notify = synchronized(stateLock) {
            val wasAuthorized = controlAuthorized
            controlAuthorized = false
            if (activeService === this) activeService = null
            wasAuthorized
        }
        if (notify) authorizationLostListener?.invoke()
    }

    private fun executeAuthorized(command: RemoteControlCommand, callback: (String?) -> Unit) {
        if (!isControlAuthorized()) {
            callback("accessibility_disabled")
            return
        }
        if (isDeviceLocked()) {
            callback("sensitive_field_blocked")
            return
        }
        if (hasVisiblePasswordField()) {
            callback("sensitive_field_blocked")
            return
        }

        when (val action = command.action) {
            is RemoteControlAction.Tap ->
                dispatchStroke(action.x, action.y, action.x, action.y, 80, callback)
            is RemoteControlAction.LongPress ->
                dispatchStroke(action.x, action.y, action.x, action.y, action.durationMs, callback)
            is RemoteControlAction.Drag ->
                dispatchStroke(action.fromX, action.fromY, action.toX, action.toY, action.durationMs, callback)
            is RemoteControlAction.Global -> {
                if (!isControlAuthorized()) {
                    callback("command_cancelled")
                    return
                }
                val globalAction = when (action.action) {
                    "BACK" -> GLOBAL_ACTION_BACK
                    "HOME" -> GLOBAL_ACTION_HOME
                    "RECENTS" -> GLOBAL_ACTION_RECENTS
                    else -> {
                        callback("action_unsupported")
                        return
                    }
                }
                callback(if (performGlobalAction(globalAction)) null else "action_unsupported")
            }
            is RemoteControlAction.TypeText -> setFocusedText(action.text, callback)
        }
    }

    private fun setFocusedText(text: String, callback: (String?) -> Unit) {
        if (text.isEmpty() || text.length > 512 || !isControlAuthorized()) {
            callback("command_cancelled")
            return
        }
        val activeWindow = windows.firstOrNull { it.isActive }
        val root = activeWindow?.root
        if (root == null) {
            callback("text_field_unavailable")
            return
        }
        try {
            val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            if (focused == null) {
                callback("text_field_unavailable")
                return
            }
            try {
                if (!isControlAuthorized()) {
                    callback("command_cancelled")
                } else if (focused.isPassword) {
                    callback("sensitive_field_blocked")
                } else if (!focused.isVisibleToUser || !focused.isEnabled || !focused.isEditable) {
                    callback("text_field_unavailable")
                } else {
                    val arguments = Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
                    }
                    callback(
                        if (focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) {
                            null
                        } else {
                            "action_unsupported"
                        }
                    )
                }
            } finally {
                if (focused !== root) focused.recycle()
            }
        } finally {
            root.recycle()
        }
    }

    private fun dispatchStroke(
        fromX: Int,
        fromY: Int,
        toX: Int,
        toY: Int,
        durationMs: Int,
        callback: (String?) -> Unit
    ) {
        if (!isControlAuthorized()) {
            callback("accessibility_disabled")
            return
        }
        if (isDeviceLocked() || hasVisiblePasswordField()) {
            callback("sensitive_field_blocked")
            return
        }
        if (!isControlAuthorized()) {
            callback("command_cancelled")
            return
        }
        val metrics = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
        if (metrics.widthPixels <= 0 || metrics.heightPixels <= 0) {
            callback("action_unsupported")
            return
        }
        val path = Path().apply {
            moveTo(pixel(fromX, metrics.widthPixels), pixel(fromY, metrics.heightPixels))
            lineTo(pixel(toX, metrics.widthPixels), pixel(toY, metrics.heightPixels))
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs.toLong()))
            .build()
        val accepted = dispatchGesture(
            gesture,
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    callback(null)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    callback("command_cancelled")
                }
            },
            Handler(Looper.getMainLooper())
        )
        if (!accepted) callback("gesture_rejected")
    }

    private fun hasVisiblePasswordField(): Boolean {
        val activeWindow = windows.firstOrNull { it.isActive } ?: return true
        val root = activeWindow.root ?: return true
        return try {
            val queue = ArrayDeque<AccessibilityNodeInfo>()
            queue.add(root)
            var inspected = 0
            var found = false
            try {
                while (queue.isNotEmpty() && inspected < MAX_NODES_TO_INSPECT) {
                    val node = queue.removeFirst()
                    inspected += 1
                    try {
                        if (node.isVisibleToUser && node.isPassword) found = true
                        if (!found) {
                            for (index in 0 until node.childCount) {
                                node.getChild(index)?.let(queue::addLast)
                            }
                        }
                    } finally {
                        if (node !== root) node.recycle()
                    }
                    if (found) break
                }
                found
            } finally {
                queue.forEach { it.recycle() }
            }
        } finally {
            root.recycle()
        }
    }

    private fun isDeviceLocked(): Boolean {
        val keyguard = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
        return keyguard.isKeyguardLocked || keyguard.isDeviceLocked
    }

    private fun pixel(value: Int, dimension: Int): Float =
        value.coerceIn(0, 10_000) * (dimension - 1) / 10_000f

    private fun isControlAuthorized(): Boolean = synchronized(stateLock) {
        controlAuthorized && activeService === this
    }

    companion object {
        private const val MAX_NODES_TO_INSPECT = 250
        private val stateLock = Any()
        @Volatile private var activeService: RemoteControlAccessibilityService? = null
        @Volatile private var controlAuthorized = false
        @Volatile private var authorizationLostListener: (() -> Unit)? = null

        fun isEnabled(context: Context): Boolean {
            val component = ComponentName(context, RemoteControlAccessibilityService::class.java)
                .flattenToString()
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ).orEmpty()
            return enabledServices.split(':').any { it.equals(component, ignoreCase = true) }
        }

        fun setAuthorizationLostListener(listener: (() -> Unit)?) {
            authorizationLostListener = listener
        }

        fun setControlAuthorized(authorized: Boolean): Boolean = synchronized(stateLock) {
            if (authorized && activeService == null) return false
            controlAuthorized = authorized
            true
        }

        fun execute(command: RemoteControlCommand, callback: (String?) -> Unit): Boolean {
            val service = synchronized(stateLock) {
                activeService?.takeIf { controlAuthorized }
            } ?: return false
            Handler(Looper.getMainLooper()).post {
                service.executeAuthorized(command, callback)
            }
            return true
        }
    }
}
