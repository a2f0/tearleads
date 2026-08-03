package com.tearleads.app

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
import java.util.concurrent.ConcurrentHashMap

internal fun revenueCatReplacementMode(name: String?): StoreReplacementMode? = when (name) {
    null -> null
    "WITHOUT_PRORATION" -> StoreReplacementMode.WITHOUT_PRORATION
    "WITH_TIME_PRORATION" -> StoreReplacementMode.WITH_TIME_PRORATION
    "CHARGE_FULL_PRICE" -> StoreReplacementMode.CHARGE_FULL_PRICE
    "CHARGE_PRORATED_PRICE" -> StoreReplacementMode.CHARGE_PRORATED_PRICE
    "DEFERRED" -> StoreReplacementMode.DEFERRED
    else -> null
}

@CapacitorPlugin(name = "RevenueCatPurchase")
class RevenueCatPurchasePlugin : Plugin() {
    private val preparedPackages = ConcurrentHashMap<String, Package>()

    @PluginMethod
    fun preparePackage(call: PluginCall) {
        preparedPackages.clear()
        if (!Purchases.isConfigured) {
            rejectBridgeValidation(call)
            return
        }
        val packageId = call.getString("packageId")
        val productId = call.getString("productId")
        if (packageId.isNullOrEmpty() || productId.isNullOrEmpty()) {
            rejectBridgeValidation(call)
            return
        }

        Purchases.sharedInstance.getOfferings(object : ReceiveOfferingsCallback {
            override fun onReceived(offerings: com.revenuecat.purchases.Offerings) {
                val prepared = offerings.current?.availablePackages?.firstOrNull {
                    it.identifier == packageId && it.product.id == productId
                }
                if (prepared == null) {
                    rejectBridgeValidation(call)
                    return
                }
                preparedPackages[packageId] = prepared
                call.resolve()
            }

            override fun onError(error: PurchasesError) {
                reject(call, error, false)
            }
        })
    }

    @PluginMethod
    fun purchasePackage(call: PluginCall) {
        if (!Purchases.isConfigured) {
            rejectBridgeValidation(call)
            return
        }
        val packageId = call.getString("packageId")
        val productId = call.getString("productId")
        if (packageId.isNullOrEmpty() || productId.isNullOrEmpty()) {
            rejectBridgeValidation(call)
            return
        }
        val replacementName = call.getString("replacementMode")
        val replacementMode = revenueCatReplacementMode(replacementName)
        if (replacementName != null && replacementMode == null) {
            rejectBridgeValidation(call)
            return
        }
        val prepared = preparedPackages.remove(packageId)
        if (prepared?.product?.id != productId) {
            rejectBridgeValidation(call)
            return
        }
        val activity = bridge.activity
        if (activity == null) {
            rejectBridgeValidation(call)
            return
        }

        val builder = PurchaseParams.Builder(activity, prepared)
        call.getString("oldProductIdentifier")?.let(builder::oldProductId)
        replacementMode?.let(builder::replacementMode)
        Purchases.sharedInstance.purchase(
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
