package com.helpconnect.android.webrtc

import java.util.concurrent.atomic.AtomicBoolean

internal class ReleaseGuard {
    private val released = AtomicBoolean(false)

    fun release(block: () -> Unit) {
        if (released.compareAndSet(false, true)) block()
    }

    fun isReleased(): Boolean = released.get()
}
