package com.helpconnect.android.signaling

import java.util.concurrent.atomic.AtomicLong

class SignalSequencer {
    private val next = AtomicLong(0)
    @Volatile private var nonce: String? = null

    fun initialize(nextSequence: Long, connectionNonce: String) {
        require(nextSequence > 0)
        require(connectionNonce.matches(Regex("^[A-Za-z0-9_-]{22}$")))
        nonce = connectionNonce
        next.set(nextSequence - 1)
    }

    fun nextSequence(): Long {
        check(nonce != null) { "WebSocket entry has not been accepted." }
        val sequence = next.incrementAndGet()
        check(sequence <= 9_007_199_254_740_991L) { "WebSocket sequence limit reached." }
        return sequence
    }

    fun connectionNonce(): String = checkNotNull(nonce) { "WebSocket entry has not been accepted." }
}
