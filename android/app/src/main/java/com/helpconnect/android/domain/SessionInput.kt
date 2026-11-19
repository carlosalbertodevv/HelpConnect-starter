package com.helpconnect.android.domain

object SessionInput {
    private val sessionCodePattern = Regex("^HC-[A-F0-9]{12}$")
    private val ticketPattern = Regex("^[A-Za-z0-9_-]{43}$")

    fun normalizeCode(value: String): String = value.trim().uppercase()

    fun isValidCode(value: String): Boolean = sessionCodePattern.matches(normalizeCode(value))

    fun isValidTicket(value: String): Boolean = ticketPattern.matches(value.trim())
}
