import type { OrganizationDeviceDataUsage } from "@tearleads/client-sdk";

/** The On device usage panel: one measurement of the active organization. */
export type DeviceDataUsageState =
  | { readonly status: "loading" }
  | {
      readonly status: "refreshing";
      readonly usage: OrganizationDeviceDataUsage;
    }
  | { readonly status: "ready"; readonly usage: OrganizationDeviceDataUsage }
  | { readonly status: "unavailable" }
  | { readonly status: "failed" };

type DeviceDataUsageEvent =
  | { readonly type: "measure" }
  | {
      readonly type: "measured";
      readonly organizationId: string;
      readonly usage: OrganizationDeviceDataUsage | null;
    }
  | { readonly type: "measureFailed" };

export const INITIAL_DEVICE_DATA_USAGE_STATE: DeviceDataUsageState = {
  status: "loading",
};

export function transitionDeviceDataUsage(
  state: DeviceDataUsageState,
  event: DeviceDataUsageEvent,
): DeviceDataUsageState {
  switch (event.type) {
    case "measure":
      // Keep the numbers on screen while re-measuring so Refresh does not
      // flicker; only a first measurement shows the loading state.
      return state.status === "ready" || state.status === "refreshing"
        ? { status: "refreshing", usage: state.usage }
        : { status: "loading" };
    case "measured":
      // The facade measures the ACTIVE organization; a result for any other
      // organization (or none) is not this organization's usage.
      return event.usage?.organizationId === event.organizationId
        ? { status: "ready", usage: event.usage }
        : { status: "unavailable" };
    case "measureFailed":
      return { status: "failed" };
  }
}
