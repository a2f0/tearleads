import type { ContainerInfo } from "@tearleads/client-sdk";
import { MiniAppInfoSection } from "../../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../../components/shared/MiniAppTable";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../labels";

function ExplorerContainerInfoLocalDetails(params: {
  containerId: string;
  containerInfo: ContainerInfo | null;
}) {
  const { containerId, containerInfo } = params;

  return (
    <MiniAppInfoTable>
      <tbody>
        <tr>
          <th>{EXPLORER_LABELS.containerInfoIdRow}</th>
          <td title={containerId}>{containerId}</td>
        </tr>
        {containerInfo ? (
          <>
            <tr>
              <th>{EXPLORER_LABELS.containerInfoCreatedRow}</th>
              <td title={containerInfo.local.createdAt ?? undefined}>
                {formatMiniAppDateTime(containerInfo.local.createdAt, {
                  emptyFallback: "-",
                })}
              </td>
            </tr>
            <tr>
              <th>{EXPLORER_LABELS.containerInfoUpdatedRow}</th>
              <td title={containerInfo.local.updatedAt ?? undefined}>
                {formatMiniAppDateTime(containerInfo.local.updatedAt, {
                  emptyFallback: "-",
                })}
              </td>
            </tr>
          </>
        ) : null}
      </tbody>
    </MiniAppInfoTable>
  );
}

export function ExplorerContainerInfoLocalSection(params: {
  containerId: string;
  containerInfo: ContainerInfo | null;
}) {
  const { containerId, containerInfo } = params;

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoLocalDetailsHeading}
    >
      <ExplorerContainerInfoLocalDetails
        containerId={containerId}
        containerInfo={containerInfo}
      />
    </MiniAppInfoSection>
  );
}
