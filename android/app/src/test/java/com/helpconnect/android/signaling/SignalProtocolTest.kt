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
        val peerState = SignalProtocol.parse(
            """{"type":"connection_state","transport":"webrtc","state":"connected","sender":"operator"}"""
        ) as ServerSignal.ConnectionState

        assertEquals("0", candidate.candidate?.sdpMid)
        assertEquals(0, candidate.candidate?.sdpMLineIndex)
        assertEquals("consent_revoked", ended.reason)
        assertEquals("operator", peerState.participant)
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

    @Test
    fun parsesAvailabilityAndBoundedRemoteActions() {
        val availability = SignalProtocol.parse(
            """{"type":"remote_control_state","available":true}"""
        ) as ServerSignal.RemoteControlState
        val tap = SignalProtocol.parse(
            """{"type":"remote_control_command","commandId":"123e4567-e89b-42d3-a456-426614174001","action":{"kind":"tap","x":10000,"y":0}}"""
        ) as ServerSignal.RemoteControlCommandReceived
        val text = SignalProtocol.parse(
            """{"type":"remote_control_command","commandId":"123e4567-e89b-42d3-a456-426614174002","action":{"kind":"type_text","text":"texto"}}"""
        ) as ServerSignal.RemoteControlCommandReceived

        assertEquals(true, availability.available)
        assertEquals(RemoteControlAction.Tap(10_000, 0), tap.command.action)
        assertEquals(RemoteControlAction.TypeText("texto"), text.command.action)
    }

    @Test
    fun rejectsLegacyApprovalMessagesAndOutOfRangeActions() {
        assertThrows(SignalProtocolException::class.java) {
            SignalProtocol.parse(
                """{"type":"remote_control_request","requestId":"123e4567-e89b-42d3-a456-426614174000"}"""
            )
        }
        assertThrows(SignalProtocolException::class.java) {
            SignalProtocol.parse(
                """{"type":"remote_control_command","commandId":"123e4567-e89b-42d3-a456-426614174001","action":{"kind":"tap","x":10001,"y":0}}"""
            )
        }
        assertThrows(SignalProtocolException::class.java) {
            SignalProtocol.parse(
                """{"type":"remote_control_command","commandId":"123e4567-e89b-42d3-a456-426614174001","action":{"kind":"global","action":"POWER"}}"""
            )
        }
        assertThrows(SignalProtocolException::class.java) {
            SignalProtocol.parse(
                """{"type":"remote_control_command","commandId":"123e4567-e89b-42d3-a456-426614174001","action":{"kind":"type_text","text":"${"x".repeat(513)}"}}"""
            )
        }
        assertThrows(SignalProtocolException::class.java) {
            SignalProtocol.parse(
                """{"type":"remote_control_command","commandId":"123e4567-e89b-42d3-a456-426614174001","action":{"kind":"drag","fromX":0,"fromY":0,"toX":10000,"toY":10000,"durationMs":5000}}"""
            )
        }
    }
}
