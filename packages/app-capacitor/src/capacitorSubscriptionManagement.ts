import { Capacitor } from "@capacitor/core";
import type { OpenSubscriptionManagementFn } from "app/host/AppHostConfig";

interface NativeSubscriptionManagementPlugin {
  show(): Promise<void>;
}

interface SubscriptionManagementDeps {
  readonly getPlatform: () => string;
  readonly openUrl: (url: string) => void;
  readonly showNative: () => Promise<void>;
}

let nativeSubscriptionManagement:
  | NativeSubscriptionManagementPlugin
  | undefined;

function showNativeSubscriptionManagement(): Promise<void> {
  nativeSubscriptionManagement ??=
    Capacitor.registerPlugin<NativeSubscriptionManagementPlugin>(
      "SubscriptionManagement",
    );
  return nativeSubscriptionManagement.show();
}

function isAppleSubscriptionManagementUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "apps.apple.com" &&
      url.pathname === "/account/subscriptions"
    );
  } catch {
    return false;
  }
}

/**
 * Opens Apple subscriptions with StoreKit on iOS, including its sandbox-aware
 * account sheet. Non-Apple provider links retain Capacitor's existing system
 * URL handoff so an org purchased on another platform stays manageable.
 */
export function createCapacitorSubscriptionManagement(
  deps: SubscriptionManagementDeps,
): OpenSubscriptionManagementFn {
  return async (managementUrl) => {
    if (
      deps.getPlatform() === "ios" &&
      isAppleSubscriptionManagementUrl(managementUrl)
    ) {
      await deps.showNative();
      return;
    }
    deps.openUrl(managementUrl);
  };
}

export const openCapacitorSubscriptionManagement =
  createCapacitorSubscriptionManagement({
    getPlatform: () => Capacitor.getPlatform(),
    openUrl: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    showNative: showNativeSubscriptionManagement,
  });
