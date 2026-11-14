import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useRuntimeScopedMemo } from "../../providers/sdk/useRuntimeScopedMemo";
import { useDeviceFirstContainerContents } from "../device-first/DeviceFirstProvider";
import { createSelfContactIdentitySource } from "./createSelfContactIdentitySource";
import type { SelfContactIdentityView } from "./currentSelfContactIdentityState";
import { useSelfContactIdentitySource } from "./useSelfContactIdentitySource";

export function useCurrentSelfContactIdentity(): SelfContactIdentityView {
  const sdk = useTearleads();
  const { view } = useDeviceFirstContainerContents();
  const source = useRuntimeScopedMemo(
    () =>
      createSelfContactIdentitySource(sdk, (listener) =>
        view.subscribe(listener),
      ),
    [sdk, view],
  );
  return useSelfContactIdentitySource(source);
}
