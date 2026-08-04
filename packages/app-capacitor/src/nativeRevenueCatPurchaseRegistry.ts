export interface NativeRevenueCatPurchasePlugin {
  preparePackage(options: {
    packageId: string;
    productId: string;
  }): Promise<void>;
  purchasePackage(options: {
    oldProductIdentifier?: string;
    packageId: string;
    productId: string;
    replacementMode?: string;
  }): Promise<{ activeEntitlementIds?: unknown }>;
}

/** Owns the process-wide registration and stable instance for the native bridge. */
export function createNativeRevenueCatPurchaseRegistry(
  registerPlugin: (name: string) => NativeRevenueCatPurchasePlugin,
): () => NativeRevenueCatPurchasePlugin {
  let plugin: NativeRevenueCatPurchasePlugin | undefined;
  return () => {
    plugin ??= registerPlugin("RevenueCatPurchase");
    return plugin;
  };
}
