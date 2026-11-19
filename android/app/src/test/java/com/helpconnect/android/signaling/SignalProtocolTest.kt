package com.helpconnect.android.signaling

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class SignalProtocolTest {
    @Test
    fun parsesJoinWithTemporaryIceConfiguration() {
        val parsed = SignalProtocol.parse(
            """{"type":"join_session","accepted":true,"participant":"device","nextSequence":4,"connectionNonce":"0123456789012345678901","iceServers":[{"urls":["stun:stun.example:3478"],"username":"temporary","credential":"secret"}]}"""
        ) as ServerSignal.Joined

        assertEquals(4L, parsed.nextSequence)
        assertEquals("device", parsed.participant)
        assertEquals("0123456789012345678901", parsed.connectionNonce)
        assertEquals("stun:stun.example:3478", parsed.iceServers.single().urls.single())
        assertEquals("temporary", parsed.iceServers.single().username)
    }

    @Test
    fun parsesOfferAnswerAndIceEndOfCandidates() {
        val offer = SignalProtocol.parse(
            """{"type":"offer","sdp":{"type":"offer","sdp":"v=0\r\n"}}"""
        ) as ServerSignal.Description
        val answer = SignalProtocol.parse(
            """{"type":"answer","sdp":{"type":"answer","sdp":"v=0\r\n"}}"""
        ) as ServerSignal.Description
        val iceEnd = SignalProtocol.parse(
            """{"type":"ice_candidate","candidate":null}"""
        ) as ServerSignal.IceCandidate

        assertEquals("offer", offer.type)
        assertEquals("answer", answer.type)
        assertNull(iceEnd.candidate)
    }

    @Test
    fun parsesRemoteIceAndSessionTermination() {
        val candidate = SignalProtocol.parse(
            """{"type":"ice_candidate","candidate":{"candidate":"candidate:1 1 UDP 1 192.0.2.1 9 typ host","sdpMid":"0","sdpMLineIndex":0}}"""
        ) as ServerSignal.IceCandidate
        val ended = SignalProtocol.parse(
            """{"type":"session_ended","reason":"consent_revoked"}"""
        ) as ServerSignal.SessionEnded

        assertEquals("0", candidate.candidate?.sdpMid)
        assertEquals(0, candidate.candidate?.sdpMLineIndex)
        assertEquals("consent_revoked", ended.reason)
    }

    @Test
    fun rejectsMismatchedOrOversizedDescriptions() {
        assertThrows(SignalProtocolException::class.java) {
            SignalProtocol.parse("""{"type":"offer","sdp":{"type":"answer","sdp":"v=0"}}""")
        }
        assertThrows(SignalProtocolException::class.java) {
            SignalProtocol.parse("""{"type":"offer","sdp":{"type":"offer","sdp":"${"x".repeat(12_001)}"}}""")
        }
    }

    @Test
    fun sequenceStartsAtServerCursorAndIncreasesWithConnectionNonce() {
        val sequencer = SignalSequencer()
        assertThrows(IllegalStateException::class.java) { sequencer.nextSequence() }

        sequencer.initialize(7, "0123456789012345678901")
        assertEquals(7, sequencer.nextSequence())
        assertEquals(8, sequencer.nextSequence())
        assertEquals("0123456789012345678901", sequencer.connectionNonce())
    }
}
