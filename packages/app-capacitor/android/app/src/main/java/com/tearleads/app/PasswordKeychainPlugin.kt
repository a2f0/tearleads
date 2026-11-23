package com.tearleads.app

import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPasswordOption
import androidx.credentials.PasswordCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialNoCreateOptionException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** A save request's account and passphrase, or null when either is missing. */
internal fun passwordKeychainEntry(account: String?, passphrase: String?): Pair<String, String>? =
    if (account.isNullOrEmpty() || passphrase.isNullOrEmpty()) null else account to passphrase

/**
 * The save outcome a Credential Manager failure stands for, or null when it is
 * a real failure. Dismissing the sheet, and a device with no password manager
 * to save to (no Google account, say), are outcomes the user can act on.
 */
internal fun passwordKeychainSaveOutcome(error: CreateCredentialException): String? =
    when (error) {
        is CreateCredentialCancellationException -> "dismissed"
        is CreateCredentialNoCreateOptionException -> "unavailable"
        else -> null
    }

/** The pick result the web layer reads: the passphrase, or nothing. */
internal fun passwordKeychainPick(passphrase: String?): JSObject =
    if (passphrase.isNullOrEmpty()) JSObject() else JSObject().put("passphrase", passphrase)

/**
 * An identity's recovery passphrase in the device's password manager, through
 * Android's Credential Manager: Google Password Manager by default. The web
 * layer's PasswordKeychain wraps it. Each call shows the system's own sheet,
 * where the user consents; dismissing it is an outcome, not a failure.
 */
@CapacitorPlugin(name = "PasswordKeychain")
class PasswordKeychainPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun handleOnDestroy() {
        scope.cancel()
    }

    @PluginMethod
    fun save(call: PluginCall) {
        val entry = passwordKeychainEntry(call.getString("account"), call.getString("passphrase"))
        if (entry == null) {
            call.reject("An account and a passphrase are required.")
            return
        }
        val activity = activity
        scope.launch {
            try {
                CredentialManager.create(activity).createCredential(
                    activity,
                    CreatePasswordRequest(entry.first, entry.second),
                )
                call.resolve(JSObject().put("outcome", "saved"))
            } catch (error: CreateCredentialException) {
                val outcome = passwordKeychainSaveOutcome(error)
                if (outcome != null) {
                    call.resolve(JSObject().put("outcome", outcome))
                } else {
                    call.reject(
                        error.errorMessage?.toString() ?: "Could not save to the password manager.",
                        error.type,
                        error,
                    )
                }
            }
        }
    }

    @PluginMethod
    fun pick(call: PluginCall) {
        val activity = activity
        scope.launch {
            try {
                val response = CredentialManager.create(activity).getCredential(
                    activity,
                    GetCredentialRequest(listOf(GetPasswordOption())),
                )
                val credential = response.credential
                call.resolve(passwordKeychainPick((credential as? PasswordCredential)?.password))
            } catch (error: GetCredentialCancellationException) {
                call.resolve(passwordKeychainPick(null))
            } catch (error: NoCredentialException) {
                call.resolve(passwordKeychainPick(null))
            } catch (error: GetCredentialException) {
                call.reject(
                    error.errorMessage?.toString() ?: "Could not read the password manager.",
                    error.type,
                    error,
                )
            }
        }
    }
}
