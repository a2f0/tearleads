import type { ContainerNode, DocumentInfo } from "@tearleads/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/mini-app/MiniAppTable";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoEpochLabel,
  getExplorerDocumentInfoPathLengthLabel,
} from "../../labels";
import { ExplorerContainerIcon } from "../../shared/ExplorerContainerIcon";
import { compactId } from "../compactId";

export function ExplorerDocumentInfoAuthorizingContainersSection(params: {
  containersById: ReadonlyMap<string, ContainerNode>;
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
            {rows.map((row) => {
              const container = params.containersById.get(row.containerId);
              return (
                <tr key={`${row.containerId}:${row.leafManifestHash ?? ""}`}>
                  <td title={row.containerId}>
                    <span className="explorer-item-name">
                      <ExplorerContainerIcon
                        className="explorer-folder-icon"
                        icon={container?.icon}
                      />
                      {container?.name ?? compactId(row.containerId)}
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
                        ? getExplorerDocumentInfoEpochLabel(
                            row.containerKeyEpoch,
                          )
                        : "-"}
                    </code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </MiniAppInfoTable>
      )}
    </MiniAppInfoSection>
  );
}
