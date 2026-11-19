package com.helpconnect.android.webrtc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseGuardTest {
    @Test
    fun cleanupRunsOnlyOnce() {
        val guard = ReleaseGuard()
        var releases = 0

        guard.release { releases++ }
        guard.release { releases++ }

        assertEquals(1, releases)
        assertTrue(guard.isReleased())
    }
}
