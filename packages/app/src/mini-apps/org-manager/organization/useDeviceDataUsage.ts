import { useCallback, useState } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useScopedOrganizationLoad } from "../billing/useScopedOrganizationLoad";
import {
  type DeviceDataUsageState,
  INITIAL_DEVICE_DATA_USAGE_STATE,
  transitionDeviceDataUsage,
} from "./deviceDataUsageState";

/**
 * Measures what this device stores for the organization while the On device
 * panel is mounted. Results are scoped to the organization and SDK binding
 * that produced them, so an organization or runtime switch drops stale
 * numbers; `remeasure` runs the measurement again.
 */
export function useDeviceDataUsage(organizationId: string): {
  readonly remeasure: () => void;
  readonly state: DeviceDataUsageState;
} {
  const { loadDeviceDataUsage } = useOrgManagerActions();
  const { logError } = useLog();
  const [measureToken, setMeasureToken] = useState(0);
  const state = useScopedOrganizationLoad<DeviceDataUsageState>({
    enabled: true,
    load: async () => {
      try {
        return transitionDeviceDataUsage(INITIAL_DEVICE_DATA_USAGE_STATE, {
          organizationId,
          type: "measured",
          usage: await loadDeviceDataUsage(),
        });
      } catch (measureError) {
        logError("Failed to measure on-device data usage", measureError);
        return transitionDeviceDataUsage(INITIAL_DEVICE_DATA_USAGE_STATE, {
          type: "measureFailed",
        });
      }
    },
    onBegin: (previousState) =>
      transitionDeviceDataUsage(
        previousState ?? INITIAL_DEVICE_DATA_USAGE_STATE,
        { type: "measure" },
      ),
    organizationId,
    reloadToken: measureToken,
    source: loadDeviceDataUsage,
  });
  const remeasure = useCallback(() => {
    setMeasureToken((token) => token + 1);
  }, []);

  return { remeasure, state: state ?? INITIAL_DEVICE_DATA_USAGE_STATE };
}
