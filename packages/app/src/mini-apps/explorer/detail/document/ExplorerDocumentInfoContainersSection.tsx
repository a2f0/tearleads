import type { DocumentInfo } from "@tearleads/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/shared/MiniAppTable";
import { ExplorerContainerIcon } from "../../ExplorerContainerIcon";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoEpochLabel,
  getExplorerDocumentInfoPathLengthLabel,
} from "../../labels";
import { compactId } from "../compactId";

export function ExplorerDocumentInfoAuthorizingContainersSection(params: {
  containerIconsById: ReadonlyMap<string, string | null>;
  containerNamesById: ReadonlyMap<string, string>;
  documentInfo: DocumentInfo;
}) {
  const remoteInfo = params.documentInfo.remoteInfo;
  const rows = remoteInfo?.authorizingContainerPaths ?? [];

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoAuthorizingContainersHeading}
    >
      {rows.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAuthorizingContainers}
        </MiniAppStatus>
      ) : (
        <MiniAppInfoTable>
          <thead>
            <tr>
              <th>{EXPLORER_LABELS.documentInfoContainerColumn}</th>
              <th>{EXPLORER_LABELS.containerInfoLaneColumn}</th>
              <th>{EXPLORER_LABELS.containerInfoCursorColumn}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.containerId}:${row.leafManifestHash ?? ""}`}>
                <td title={row.containerId}>
                  <span className="explorer-item-name">
                    <ExplorerContainerIcon
                      className="explorer-folder-icon"
                      icon={params.containerIconsById.get(row.containerId)}
                    />
                    {params.containerNamesById.get(row.containerId) ??
                      compactId(row.containerId)}
                  </span>
                </td>
                <td>
                  {getExplorerDocumentInfoPathLengthLabel(row.pathLength)}
                </td>
                <td>
                  <div title={row.leafManifestHash ?? undefined}>
                    {compactId(row.leafManifestHash)}
                  </div>
                  <code title={row.containerKeyEpochId ?? undefined}>
                    {row.containerKeyEpoch != null
                      ? getExplorerDocumentInfoEpochLabel(row.containerKeyEpoch)
                      : "-"}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </MiniAppInfoTable>
      )}
    </MiniAppInfoSection>
  );
}
