import type { PurchasesCapability } from "@tearleads/client-sdk";

interface CachedCapacitorPurchases {
  readonly apiKey: string;
  readonly capability: PurchasesCapability;
  readonly operationTimeoutMs: number | undefined;
  readonly platform: string;
  readonly syncEntitlementId: string;
}

let cachedCapacitorPurchases: CachedCapacitorPurchases | undefined;

export function getCachedCapacitorPurchases():
  | CachedCapacitorPurchases
  | undefined {
  return cachedCapacitorPurchases;
}

export function setCachedCapacitorPurchases(
  cached: CachedCapacitorPurchases | undefined,
): void {
  cachedCapacitorPurchases = cached;
}
