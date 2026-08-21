import type { ContainerInfo } from "@symcrypt/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/mini-app/MiniAppTable";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { compactId } from "../compactId";

function ExplorerContainerInfoSyncCursorList(params: {
  containerInfo: NonNullable<ContainerInfo["remoteInfo"]>;
}) {
  const { containerInfo } = params;

  return (
    <MiniAppInfoTable>
      <thead>
        <tr>
          <th>{EXPLORER_LABELS.containerInfoLaneColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoCursorColumn}</th>
          <th>{EXPLORER_LABELS.containerInfoSavedColumn}</th>
        </tr>
      </thead>
      <tbody>
        {containerInfo.syncCursors.map((cursor) => (
          <tr key={`${cursor.laneKind}:${cursor.laneId}`}>
            <td>
              <div>{cursor.label}</div>
              <code title={`${cursor.laneKind}:${cursor.laneId}`}>
                {cursor.laneKind}/{cursor.laneId}
              </code>
            </td>
            <td>
              {cursor.watermarkUpdatedAt ? (
                <>
                  <div title={cursor.watermarkUpdatedAt}>
                    {formatMiniAppDateTime(cursor.watermarkUpdatedAt)}
                  </div>
                  <code title={cursor.watermarkId ?? undefined}>
                    {cursor.watermarkId ? compactId(cursor.watermarkId) : ""}
                  </code>
                </>
              ) : (
                <MiniAppStatus as="span">
                  {EXPLORER_LABELS.containerInfoNoLocalCursor}
                </MiniAppStatus>
              )}
            </td>
            <td title={cursor.savedAt ?? undefined}>
              {formatMiniAppDateTime(cursor.savedAt, { emptyFallback: "-" })}
            </td>
          </tr>
        ))}
      </tbody>
    </MiniAppInfoTable>
  );
}

export function ExplorerContainerInfoSyncCursorsSection(params: {
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
}) {
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoSyncCursorsHeading}
    >
      <ExplorerContainerInfoSyncCursorList containerInfo={params.remoteInfo} />
    </MiniAppInfoSection>
  );
}
