package com.tearleads.app

import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialNoCreateOptionException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class PasswordKeychainPluginTest {
    @Test
    fun saveNeedsBothAnAccountAndAPassphrase() {
        assertEquals("Identity 0123" to "a b c", passwordKeychainEntry("Identity 0123", "a b c"))
        assertNull(passwordKeychainEntry(null, "a b c"))
        assertNull(passwordKeychainEntry("Identity 0123", ""))
    }

    @Test
    fun aDismissedSheetOrMissingPasswordManagerIsAnOutcomeNotAFailure() {
        assertEquals("dismissed", passwordKeychainSaveOutcome(CreateCredentialCancellationException()))
        assertEquals("unavailable", passwordKeychainSaveOutcome(CreateCredentialNoCreateOptionException()))
        assertNull(passwordKeychainSaveOutcome(CreateCredentialUnknownException()))
    }

    @Test
    fun pickReportsAPassphraseOnlyWhenOneWasChosen() {
        assertEquals("a b c", passwordKeychainPick("a b c").getString("passphrase"))
        assertFalse(passwordKeychainPick(null).has("passphrase"))
        assertFalse(passwordKeychainPick("").has("passphrase"))
    }

    @Test
    fun exposesTheMethodsTheWebLayerCalls() {
        val plugin = PasswordKeychainPlugin::class.java
        assertEquals("PasswordKeychain", plugin.getAnnotation(CapacitorPlugin::class.java)?.name)
        // Declared only: Capacitor's Plugin base class contributes its own.
        val methods = plugin.declaredMethods
            .filter { it.isAnnotationPresent(PluginMethod::class.java) }
            .map { it.name }
            .sorted()
        assertEquals(listOf("pick", "save"), methods)
    }
}
