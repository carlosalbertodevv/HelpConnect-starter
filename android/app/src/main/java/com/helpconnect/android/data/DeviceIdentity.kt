package com.helpconnect.android.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

interface DeviceIdentity {
    fun publicKey(): String
    fun sign(message: String): String
}

class AndroidDeviceIdentity : DeviceIdentity {
    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }

    override fun publicKey(): String = Base64.encodeToString(
        keyStore.getCertificate(KEY_ALIAS)?.publicKey?.encoded
            ?: createKeyPair().public.encoded,
        Base64.NO_WRAP
    )

    override fun sign(message: String): String {
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as? PrivateKey
            ?: createKeyPair().private
        val signer = Signature.getInstance(SIGNATURE_ALGORITHM)
        signer.initSign(privateKey)
        signer.update(message.toByteArray(Charsets.UTF_8))
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign())
    }

    private fun createKeyPair(): java.security.KeyPair {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEY_STORE)
        generator.initialize(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec(CURVE))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build()
        )
        return generator.generateKeyPair()
    }

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val KEY_ALIAS = "helpconnect-device-identity"
        const val CURVE = "secp256r1"
        const val SIGNATURE_ALGORITHM = "SHA256withECDSA"
    }
}
