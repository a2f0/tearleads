import { useTearleads } from "../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalValue } from "../../providers/sdk/useTearleadsSubscription";
import { documentsAuthorityGeneration } from "./documentsAuthority";

/** A memo key that, unlike the runtime snapshot, survives notifications
 * which leave the documents authority unchanged. */
export function useDocumentsAuthorityGeneration(): number {
  const sdk = useTearleads();
  return useTearleadsExternalValue(sdk.runtime.subscribe, () =>
    documentsAuthorityGeneration(sdk),
  );
}
