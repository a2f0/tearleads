package com.tearleads.app

import android.app.Activity
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.EntitlementInfo
import com.revenuecat.purchases.EntitlementInfos
import com.revenuecat.purchases.Offering
import com.revenuecat.purchases.Offerings
import com.revenuecat.purchases.OwnershipType
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PackageType
import com.revenuecat.purchases.PeriodType
import com.revenuecat.purchases.PresentedOfferingContext
import com.revenuecat.purchases.ProductType
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Store
import com.revenuecat.purchases.VerificationResult
import com.revenuecat.purchases.interfaces.PurchaseCallback
import com.revenuecat.purchases.interfaces.ReceiveOfferingsCallback
import com.revenuecat.purchases.models.Price
import com.revenuecat.purchases.models.PurchaseState
import com.revenuecat.purchases.models.PurchaseType
import com.revenuecat.purchases.models.StoreProduct
import com.revenuecat.purchases.models.StoreReplacementMode
import com.revenuecat.purchases.models.StoreTransaction
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Proxy
import java.util.Date

class RevenueCatPurchasePluginTest {
    private class RecordingPluginCall(
        methodName: String,
        data: JSObject = JSObject(),
    ) : PluginCall(
        null,
        "RevenueCatPurchase",
        "callback",
        methodName,
        data,
    ) {
        var rejectionCode: String? = null
        var resolution: JSObject? = null
        var resolved = false

        override fun reject(message: String?, code: String?, data: JSObject?) {
            rejectionCode = code
        }

        override fun resolve(data: JSObject?) {
            resolution = data
            resolved = true
        }

        override fun resolve() {
            resolved = true
        }
    }

    private class RecordingPurchaseClient(
        private val offerings: Offerings,
    ) : RevenueCatPurchaseClient {
        var purchaseParams: PurchaseParams? = null
        private var purchaseCallback: PurchaseCallback? = null

        override fun getOfferings(callback: ReceiveOfferingsCallback) {
            callback.onReceived(offerings)
        }

        override fun purchase(params: PurchaseParams, callback: PurchaseCallback) {
            purchaseParams = params
            purchaseCallback = callback
        }

        fun complete(customerInfo: CustomerInfo) {
            requireNotNull(purchaseCallback).onCompleted(
                storeTransaction(),
                customerInfo,
            )
        }
    }

    companion object {
        private fun storeTransaction(): StoreTransaction = StoreTransaction(
            "order-1",
            listOf("team-product"),
            ProductType.SUBS,
            0,
            "purchase-token",
            PurchaseState.PURCHASED,
            true,
            "signature",
            JSONObject(),
            PresentedOfferingContext("offering"),
            null,
            PurchaseType.GOOGLE_PURCHASE,
            null,
            null,
            null,
        )
    }

    private fun fakePackage(packageId: String, productId: String): Package {
        lateinit var product: StoreProduct
        product = Proxy.newProxyInstance(
            StoreProduct::class.java.classLoader,
            arrayOf(StoreProduct::class.java),
        ) { _, method, _ ->
            when (method.name) {
                "getId", "getSku" -> productId
                "getName", "getTitle", "getDescription" -> "Test product"
                "getPresentedOfferingIdentifier" -> "offering"
                "getType" -> ProductType.SUBS
                "getPrice" -> Price("\$5.00", 5_000_000, "USD")
                "copyWithOfferingId", "copyWithPresentedOfferingContext" -> product
                "hashCode" -> System.identityHashCode(product)
                "toString" -> "FakeStoreProduct($productId)"
                else -> null
            }
        } as StoreProduct
        return Package(
            packageId,
            PackageType.MONTHLY,
            product,
            PresentedOfferingContext("offering"),
        )
    }

    private fun configuredPlugin(
        cache: PreparedPackageCache<Package> = PreparedPackageCache(),
    ): RevenueCatPurchasePlugin = RevenueCatPurchasePlugin(
        cache,
        { true },
        { null },
    )

    private fun purchaseCall(
        packageId: String? = "team",
        productId: String? = "team-product",
        oldProductIdentifier: String? = null,
        replacementMode: String? = null,
    ): RecordingPluginCall {
        val data = JSObject()
        packageId?.let { data.put("packageId", it) }
        productId?.let { data.put("productId", it) }
        oldProductIdentifier?.let { data.put("oldProductIdentifier", it) }
        replacementMode?.let { data.put("replacementMode", it) }
        return RecordingPluginCall("purchasePackage", data)
    }

    private fun prepareCall(
        packageId: String = "team",
        productId: String = "team-product",
    ): RecordingPluginCall = RecordingPluginCall(
        "preparePackage",
        JSObject().put("packageId", packageId).put("productId", productId),
    )

    private fun customerInfo(vararg entitlementIds: String): CustomerInfo {
        val date = Date(0)
        val entitlements = entitlementIds.associateWith { entitlementId ->
            EntitlementInfo(
                entitlementId,
                true,
                true,
                PeriodType.NORMAL,
                date,
                date,
                Date(Long.MAX_VALUE),
                Store.PLAY_STORE,
                "team-product",
                null,
                true,
                null,
                null,
                OwnershipType.PURCHASED,
                JSONObject(),
                VerificationResult.NOT_REQUESTED,
            )
        }
        return CustomerInfo(
            EntitlementInfos(entitlements, VerificationResult.NOT_REQUESTED),
            emptyMap(),
            emptyMap(),
            date,
            3,
            date,
            "user-1",
            null,
            null,
            JSONObject().put("subscriber", JSONObject()),
        )
    }

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

    @Test
    fun exposesTheCapacitorPluginEntryPoints() {
        val plugin = RevenueCatPurchasePlugin::class.java
        val annotation = requireNotNull(
            plugin.getAnnotation(CapacitorPlugin::class.java),
        )
        assertEquals(
            "RevenueCatPurchase",
            annotation.name,
        )
        assertNotNull(plugin.getConstructor())
        assertTrue(
            plugin.getDeclaredMethod("preparePackage", PluginCall::class.java)
                .isAnnotationPresent(PluginMethod::class.java),
        )
        assertTrue(
            plugin.getDeclaredMethod("purchasePackage", PluginCall::class.java)
                .isAnnotationPresent(PluginMethod::class.java),
        )
    }

    @Test
    fun entryPointsFailClosedBeforeRevenueCatIsConfigured() {
        val plugin = RevenueCatPurchasePlugin(
            PreparedPackageCache(),
            { false },
            { null },
        )
        val prepare = RecordingPluginCall("preparePackage")
        val purchase = RecordingPluginCall("purchasePackage")

        plugin.preparePackage(prepare)
        plugin.purchasePackage(purchase)

        assertEquals("bridge-invalid", prepare.rejectionCode)
        assertEquals("bridge-invalid", purchase.rejectionCode)
    }

    @Test
    fun prepareEntryPointRejectsMissingPackageIdentity() {
        val call = RecordingPluginCall("preparePackage")

        configuredPlugin().preparePackage(call)

        assertEquals("bridge-invalid", call.rejectionCode)
    }

    @Test
    fun purchaseEntryPointRejectsMalformedProductChanges() {
        val calls = listOf(
            purchaseCall(packageId = null),
            purchaseCall(productId = null),
            purchaseCall(oldProductIdentifier = "solo"),
            purchaseCall(replacementMode = "DEFERRED"),
            purchaseCall(oldProductIdentifier = "", replacementMode = "DEFERRED"),
            purchaseCall(oldProductIdentifier = "solo", replacementMode = "UNKNOWN"),
        )
        val plugin = configuredPlugin()

        calls.forEach(plugin::purchasePackage)

        assertTrue(calls.all { it.rejectionCode == "bridge-invalid" })
    }

    @Test
    fun purchaseEntryPointConsumesOnlyTheExactPreparedPackage() {
        val cache = PreparedPackageCache<Package>()
        cache.replace("team", fakePackage("team", "team-product"))
        val mismatch = purchaseCall(productId = "stale-product")
        val plugin = configuredPlugin(cache)

        plugin.purchasePackage(mismatch)

        assertEquals("bridge-invalid", mismatch.rejectionCode)
        assertNull(cache.consume("team", "team-product") { it.product.id })
    }

    @Test
    fun purchaseEntryPointFailsClosedWithoutAnActivity() {
        val cache = PreparedPackageCache<Package>()
        cache.replace("team", fakePackage("team", "team-product"))
        val call = purchaseCall()

        configuredPlugin(cache).purchasePackage(call)

        assertEquals("bridge-invalid", call.rejectionCode)
    }

    @Test
    fun successfulPurchaseUsesThePreparedPackageAndResolvesEntitlements() {
        val prepared = fakePackage("team", "team-product")
        val offering = Offering(
            "current",
            "Test offering",
            emptyMap(),
            listOf(prepared),
        )
        val purchaseClient = RecordingPurchaseClient(
            Offerings(offering, mapOf(offering.identifier to offering)),
        )
        val plugin = RevenueCatPurchasePlugin(
            PreparedPackageCache(),
            { true },
            { Activity() },
            purchaseClient,
        )
        val prepare = prepareCall()
        val purchase = purchaseCall(
            oldProductIdentifier = "solo-product",
            replacementMode = "CHARGE_PRORATED_PRICE",
        )

        plugin.preparePackage(prepare)
        plugin.purchasePackage(purchase)

        assertTrue(prepare.resolved)
        assertEquals("solo-product", purchaseClient.purchaseParams?.oldProductId)
        assertEquals(
            StoreReplacementMode.CHARGE_PRORATED_PRICE,
            purchaseClient.purchaseParams?.replacementMode,
        )
        purchaseClient.complete(customerInfo("sync", "extra"))
        assertEquals(
            "{\"activeEntitlementIds\":[\"extra\",\"sync\"]}",
            purchase.resolution.toString(),
        )
    }

    @Test
    fun offeringsMatchBothPackageAndProductIdentity() {
        val packages = listOf(
            fakePackage("solo", "solo-product"),
            fakePackage("team", "team-product"),
        )

        assertEquals(
            packages[1],
            findRevenueCatPackage(packages, "team", "team-product"),
        )
        assertNull(findRevenueCatPackage(packages, "team", "stale-product"))
        assertNull(findRevenueCatPackage(packages, "missing", "team-product"))
    }
}
