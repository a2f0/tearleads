package com.tearleads.app

import android.app.Activity
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.interfaces.PurchaseCallback
import com.revenuecat.purchases.interfaces.ReceiveOfferingsCallback
import com.revenuecat.purchases.models.StoreReplacementMode
import com.revenuecat.purchases.models.StoreTransaction

internal class PreparedPackageCache<T> {
    private val entries = HashMap<String, T>()

    @Synchronized
    fun clear() {
        entries.clear()
    }

    @Synchronized
    fun replace(packageId: String, value: T) {
        entries.clear()
        entries[packageId] = value
    }

    @Synchronized
    fun consume(
        packageId: String,
        expectedProductId: String,
        productId: (T) -> String,
    ): T? {
        val value = entries.remove(packageId) ?: return null
        return value.takeIf { productId(it) == expectedProductId }
    }
}

internal fun revenueCatReplacementMode(name: String?): StoreReplacementMode? = when (name) {
    null -> null
    "WITHOUT_PRORATION" -> StoreReplacementMode.WITHOUT_PRORATION
    "WITH_TIME_PRORATION" -> StoreReplacementMode.WITH_TIME_PRORATION
    "CHARGE_FULL_PRICE" -> StoreReplacementMode.CHARGE_FULL_PRICE
    "CHARGE_PRORATED_PRICE" -> StoreReplacementMode.CHARGE_PRORATED_PRICE
    "DEFERRED" -> StoreReplacementMode.DEFERRED
    else -> null
}

internal data class RevenueCatProductChange(
    val oldProductIdentifier: String?,
    val replacementMode: StoreReplacementMode?,
)

internal fun revenueCatProductChange(
    oldProductIdentifier: String?,
    replacementName: String?,
): RevenueCatProductChange? {
    if (
        (oldProductIdentifier == null) != (replacementName == null) ||
        oldProductIdentifier?.isEmpty() == true
    ) {
        return null
    }
    val replacementMode = revenueCatReplacementMode(replacementName)
    if (replacementName != null && replacementMode == null) return null
    return RevenueCatProductChange(oldProductIdentifier, replacementMode)
}

internal fun findRevenueCatPackage(
    packages: List<Package>,
    packageId: String,
    productId: String,
): Package? = packages.firstOrNull {
    it.identifier == packageId && it.product.id == productId
}

internal interface RevenueCatPurchaseClient {
    fun getOfferings(callback: ReceiveOfferingsCallback)

    fun purchase(params: PurchaseParams, callback: PurchaseCallback)
}

private object SharedRevenueCatPurchaseClient : RevenueCatPurchaseClient {
    override fun getOfferings(callback: ReceiveOfferingsCallback) {
        Purchases.sharedInstance.getOfferings(callback)
    }

    override fun purchase(params: PurchaseParams, callback: PurchaseCallback) {
        Purchases.sharedInstance.purchase(params, callback)
    }
}

@CapacitorPlugin(name = "RevenueCatPurchase")
class RevenueCatPurchasePlugin internal constructor(
    private val preparedPackages: PreparedPackageCache<Package>,
    private val purchasesConfigured: () -> Boolean,
    private val activityProvider: (() -> Activity?)?,
    private val purchaseClient: RevenueCatPurchaseClient = SharedRevenueCatPurchaseClient,
) : Plugin() {
    constructor() : this(
        PreparedPackageCache(),
        { Purchases.isConfigured },
        null,
    )

    @PluginMethod
    fun assertConfigured(call: PluginCall) {
        if (!purchasesConfigured()) {
            rejectBridgeValidation(call)
            return
        }
        call.resolve()
    }

    @PluginMethod
    fun preparePackage(call: PluginCall) {
        preparedPackages.clear()
        if (!purchasesConfigured()) {
            rejectBridgeValidation(call)
            return
        }
        val packageId = call.getString("packageId")
        val productId = call.getString("productId")
        if (packageId.isNullOrEmpty() || productId.isNullOrEmpty()) {
            rejectBridgeValidation(call)
            return
        }

        purchaseClient.getOfferings(object : ReceiveOfferingsCallback {
            override fun onReceived(offerings: com.revenuecat.purchases.Offerings) {
                val prepared = findRevenueCatPackage(
                    offerings.current?.availablePackages.orEmpty(),
                    packageId,
                    productId,
                )
                if (prepared == null) {
                    rejectBridgeValidation(call)
                    return
                }
                preparedPackages.replace(packageId, prepared)
                call.resolve()
            }

            override fun onError(error: PurchasesError) {
                reject(call, error, false)
            }
        })
    }

    @PluginMethod
    fun purchasePackage(call: PluginCall) {
        if (!purchasesConfigured()) {
            rejectBridgeValidation(call)
            return
        }
        val packageId = call.getString("packageId")
        val productId = call.getString("productId")
        if (packageId.isNullOrEmpty() || productId.isNullOrEmpty()) {
            rejectBridgeValidation(call)
            return
        }
        val oldProductIdentifier = call.getString("oldProductIdentifier")
        val replacementName = call.getString("replacementMode")
        val productChange = revenueCatProductChange(
            oldProductIdentifier,
            replacementName,
        )
        if (productChange == null) {
            preparedPackages.clear()
            rejectBridgeValidation(call)
            return
        }
        val prepared = preparedPackages.consume(packageId, productId) {
            it.product.id
        }
        if (prepared == null) {
            rejectBridgeValidation(call)
            return
        }
        val activity = if (activityProvider == null) {
            bridge.activity
        } else {
            activityProvider.invoke()
        }
        if (activity == null) {
            rejectBridgeValidation(call)
            return
        }

        val builder = PurchaseParams.Builder(activity, prepared)
        productChange.oldProductIdentifier?.let(builder::oldProductId)
        productChange.replacementMode?.let(builder::replacementMode)
        purchaseClient.purchase(
            builder.build(),
            object : PurchaseCallback {
                override fun onCompleted(
                    storeTransaction: StoreTransaction,
                    customerInfo: CustomerInfo,
                ) {
                    call.resolve(
                        JSObject().put(
                            "activeEntitlementIds",
                            JSArray(customerInfo.entitlements.active.keys.sorted()),
                        ),
                    )
                }

                override fun onError(error: PurchasesError, userCancelled: Boolean) {
                    reject(call, error, userCancelled)
                }
            },
        )
    }

    private fun reject(call: PluginCall, error: PurchasesError, userCancelled: Boolean) {
        call.reject(
            "RevenueCat purchase failed",
            error.code.code.toString(),
            JSObject().put("userCancelled", userCancelled),
        )
    }

    private fun rejectBridgeValidation(call: PluginCall) {
        call.reject(
            "RevenueCat purchase failed",
            "bridge-invalid",
            JSObject().put("userCancelled", false),
        )
    }
}
