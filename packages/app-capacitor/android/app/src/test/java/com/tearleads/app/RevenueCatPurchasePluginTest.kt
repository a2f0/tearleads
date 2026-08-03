package com.tearleads.app

import com.revenuecat.purchases.models.StoreReplacementMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RevenueCatPurchasePluginTest {
    @Test
    fun preparedPackagesAreValidatedAndConsumedOnce() {
        val cache = PreparedPackageCache<String>()
        cache.replace("solo", "solo-product")
        cache.replace("team", "team-product")

        assertNull(cache.consume("solo", "solo-product") { it })
        assertEquals("team-product", cache.consume("team", "team-product") { it })
        assertNull(cache.consume("team", "team-product") { it })
    }

    @Test
    fun aMismatchedProductConsumesThePreparedPackage() {
        val cache = PreparedPackageCache<String>()
        cache.replace("team", "team-product")

        assertNull(cache.consume("team", "stale-product") { it })
        assertNull(cache.consume("team", "team-product") { it })
    }

    @Test
    fun clearingTheCacheInvalidatesAStalePreparedPackage() {
        val cache = PreparedPackageCache<String>()
        cache.replace("team", "team-product")

        cache.clear()

        assertNull(cache.consume("team", "team-product") { it })
    }

    @Test
    fun mapsEverySupportedReplacementMode() {
        val expected = mapOf(
            "WITHOUT_PRORATION" to StoreReplacementMode.WITHOUT_PRORATION,
            "WITH_TIME_PRORATION" to StoreReplacementMode.WITH_TIME_PRORATION,
            "CHARGE_FULL_PRICE" to StoreReplacementMode.CHARGE_FULL_PRICE,
            "CHARGE_PRORATED_PRICE" to StoreReplacementMode.CHARGE_PRORATED_PRICE,
            "DEFERRED" to StoreReplacementMode.DEFERRED,
        )

        expected.forEach { (name, mode) ->
            assertEquals(mode, revenueCatReplacementMode(name))
        }
    }

    @Test
    fun rejectsUnknownReplacementModes() {
        assertNull(revenueCatReplacementMode(null))
        assertNull(revenueCatReplacementMode("UNKNOWN"))
    }
}
