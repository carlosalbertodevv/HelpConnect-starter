package com.helpconnect.android.domain

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionInputTest {
    @Test
    fun acceptsBackendSessionCodesAndNormalizesCase() {
        assertTrue(SessionInput.isValidCode("hc-abcdef012345"))
        assertTrue(SessionInput.isValidCode(" HC-ABCDEF012345 "))
        assertFalse(SessionInput.isValidCode("HC-ABCDEF01234"))
        assertFalse(SessionInput.isValidCode("HC-ABCDEF01234Z"))
    }

    @Test
    fun acceptsOnlyTheBackendOneTimeTicketShape() {
        assertTrue(SessionInput.isValidTicket("A".repeat(43)))
        assertFalse(SessionInput.isValidTicket("short"))
        assertFalse(SessionInput.isValidTicket("A".repeat(42) + "!"))
    }
}
