import type { RevenueCatBackend } from "../../src/client/billing/purchases";
import { createRevenueCatIdentityCoordinator } from "../../src/client/billing/revenueCatIdentity";

interface RecordingBackend extends RevenueCatBackend {
  readonly calls: string[];
}

/**
 * Recording RevenueCat backend fake for the identity-coordinator tests. Every
 * identity-relevant call is appended to `calls`; individual methods are
 * reassigned by tests that need to pace or fail an operation.
 */
export function createRecordingBackend(): RecordingBackend {
  const calls: string[] = [];
  return {
    calls,
    async configure(input) {
      calls.push(`configure:${input.appUserId ?? "anonymous"}`);
    },
    async logIn(input) {
      calls.push(`login:${input.appUserId}`);
    },
    async logOut() {
      calls.push("logout");
    },
    async setAttributes() {},
    async getCurrentPackages() {
      return [];
    },
    async purchasePackage() {
      return { activeEntitlementIds: [] };
    },
    async getCustomerInfo() {
      return { activeEntitlementIds: [] };
    },
    async restorePurchases() {
      return { activeEntitlementIds: [] };
    },
  };
}

export function createDeferred() {
  let resolve = () => {};
  let reject = (_error: unknown) => {};
  const promise = new Promise<void>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

export function createCoordinator(
  backend: RevenueCatBackend,
  timeoutMs = 1_000,
  checkoutSettlementTimeoutMs = 1_000,
) {
  return createRevenueCatIdentityCoordinator({
    apiKey: "key",
    backend,
    checkoutSettlementTimeoutMs,
    timeoutMs,
  });
}
