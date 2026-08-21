import type { OrganizationDirectoryAndGroups } from "@symcrypt/client-sdk";
import type { RuntimeSnapshot } from "../../../providers/sdk/SymCryptProvider";
import { useExplorerAttributionUserLabels } from "./useExplorerAttributionUserLabels";
import {
  type ExplorerOrganizationReadModelScope,
  useExplorerOrganizationReadModelDemand,
} from "./useExplorerOrganizationReadModelDemand";

export function useExplorerOrganizationPresentation(input: {
  readonly appData: RuntimeSnapshot;
  readonly view: string;
}): {
  readonly projection: OrganizationDirectoryAndGroups | null;
  readonly resolveAttributionUserLabel: ReturnType<
    typeof useExplorerAttributionUserLabels
  >;
  readonly revision: number;
  readonly scope: ExplorerOrganizationReadModelScope | null;
} {
  const demand = useExplorerOrganizationReadModelDemand({
    appData: input.appData,
    enabled: input.view === "container-info" || input.view === "document-info",
  });
  const resolveAttributionUserLabel = useExplorerAttributionUserLabels({
    appData: input.appData,
    enabled: input.view === "document-info",
    readModelProjection: demand.projection,
    readModelRevision: demand.revision,
  });
  return { ...demand, resolveAttributionUserLabel };
}
