package com.helpconnect.android.data

import android.os.Build
import com.helpconnect.android.BuildConfig

internal fun selectApiBaseUrl(
    isEmulator: Boolean,
    emulatorApiBaseUrl: String,
    lanApiBaseUrl: String
): String = if (isEmulator) emulatorApiBaseUrl else lanApiBaseUrl

object ApiEndpoint {
    fun baseUrl(): String = selectApiBaseUrl(
        isEmulator = isEmulator(),
        emulatorApiBaseUrl = BuildConfig.EMULATOR_API_BASE_URL,
        lanApiBaseUrl = BuildConfig.LAN_API_BASE_URL
    )

    private fun isEmulator(): Boolean =
        Build.FINGERPRINT.startsWith("generic") ||
            Build.FINGERPRINT.startsWith("unknown") ||
            Build.MODEL.contains("google_sdk", ignoreCase = true) ||
            Build.MODEL.contains("emulator", ignoreCase = true) ||
            Build.MODEL.contains("Android SDK built for", ignoreCase = true) ||
            Build.HARDWARE.contains("goldfish", ignoreCase = true) ||
            Build.HARDWARE.contains("ranchu", ignoreCase = true)
}
