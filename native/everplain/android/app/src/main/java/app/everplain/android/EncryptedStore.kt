package app.everplain.android

import android.annotation.SuppressLint
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.everplain.core.PrivateStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Per-install AES-GCM storage. Neither session cookies nor pending messages enter backups. */
// Synchronous commit is intentional: recovery intent must be durable before POST.
// The platform API is used so a failed commit is observable, unlike KTX edit.
@SuppressLint("ApplySharedPref", "UseKtx")
class EncryptedStore(context: Context) : PrivateStore {
    private val preferences =
        context.getSharedPreferences("everplain_private", Context.MODE_PRIVATE)
    private val alias = "everplain.native.private.v1"

    private fun encryptionKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            alias,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build()
                )
            }
            .generateKey()
    }

    @Synchronized
    override fun read(key: String): String? {
        val encoded = preferences.getString(key, null) ?: return null
        return try {
            val bytes = Base64.decode(encoded, Base64.NO_WRAP)
            require(bytes.size >= 28)
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(
                    Cipher.DECRYPT_MODE,
                    encryptionKey(),
                    GCMParameterSpec(128, bytes.copyOfRange(0, 12)),
                )
                updateAAD(key.toByteArray(Charsets.UTF_8))
                doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8)
            }
        } catch (_: Exception) {
            preferences.edit().remove(key).commit()
            null
        }
    }

    @Synchronized
    override fun write(key: String, value: String?) {
        if (value == null) {
            check(preferences.edit().remove(key).commit())
            return
        }
        val cipher =
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.ENCRYPT_MODE, encryptionKey())
                updateAAD(key.toByteArray(Charsets.UTF_8))
            }
        val encrypted = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        check(
            preferences
                .edit()
                .putString(key, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .commit()
        )
    }

    @Synchronized
    override fun clear() {
        check(preferences.edit().clear().commit())
    }
}
