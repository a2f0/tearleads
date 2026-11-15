import { useMemo } from "react";
import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useDeviceFirstContainerContents } from "../device-first/DeviceFirstProvider";
import { useDocumentsAuthorityGeneration } from "../documents/documentsAuthority";
import { createSelfContactIdentitySource } from "./createSelfContactIdentitySource";
import type { SelfContactIdentityView } from "./currentSelfContactIdentityState";
import { useSelfContactIdentitySource } from "./useSelfContactIdentitySource";

export function useCurrentSelfContactIdentity(): SelfContactIdentityView {
  const sdk = useTearleads();
  const { view } = useDeviceFirstContainerContents();
  const authority = useDocumentsAuthorityGeneration();
  // Every source input (database, signing fingerprint) is authority-scoped,
  // so ordinary runtime notifications keep the source and its ready view.
  const source = useMemo(
    () => createSelfContactIdentitySource(sdk, view, authority),
    [authority, sdk, view],
  );
  return useSelfContactIdentitySource(source);
}
