package com.helpconnect.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiEndpointTest {
    @Test
    fun emulatorUsesHostGatewayUrl() {
        assertEquals(
            "http://10.0.2.2:3001/api",
            selectApiBaseUrl(
                isEmulator = true,
                emulatorApiBaseUrl = "http://10.0.2.2:3001/api",
                lanApiBaseUrl = "http://192.168.2.12:3001/api"
            )
        )
    }

    @Test
    fun physicalDeviceUsesLanUrl() {
        assertEquals(
            "http://192.168.2.12:3001/api",
            selectApiBaseUrl(
                isEmulator = false,
                emulatorApiBaseUrl = "http://10.0.2.2:3001/api",
                lanApiBaseUrl = "http://192.168.2.12:3001/api"
            )
        )
    }
}
