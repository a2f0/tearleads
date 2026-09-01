import type { ContainerInfo } from "@tearleads/client-sdk";
import {
  MiniAppInfoHeading,
  MiniAppInfoSection,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/mini-app/MiniAppTable";
import {
  EXPLORER_LABELS,
  getExplorerContainerInfoEventLabel,
  getExplorerContainerInfoGrantSummaryLabel,
  getExplorerContainerInfoManifestHistoryLabel,
  getExplorerContainerInfoPathSummaryLabel,
  getExplorerContainerInfoRecipientSummaryLabel,
} from "../../labels";
import { compactId } from "../compactId";

export function ExplorerContainerInfoSecuritySection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
}) {
  const { containerNamesById, remoteInfo } = params;
  const security = remoteInfo.security;
  if (!security) {
    return null;
  }

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.containerInfoSecurityHeading}>
      <MiniAppInfoTable>
        <tbody>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityManifestHashRow}</th>
            <td title={security.currentManifestHash}>
              {compactId(security.currentManifestHash)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}</th>
            <td title={security.currentContainerKeyEpochId}>
              {security.currentContainerKeyEpoch} /{" "}
              {compactId(security.currentContainerKeyEpochId)}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoSecurityParentKeyEpochRow}</th>
            <td title={security.currentParentContainerKeyEpochId ?? undefined}>
              {security.currentParentContainerKeyEpochId
                ? compactId(security.currentParentContainerKeyEpochId)
                : "-"}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoManifestHistoryRow}</th>
            <td>
              {getExplorerContainerInfoManifestHistoryLabel(
                security.currentManifestHistoryCount,
              )}
            </td>
          </tr>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoPathRow}</th>
            <td>
              {getExplorerContainerInfoPathSummaryLabel({
                pathLength: security.pathLength,
                referencedPrincipalCount:
                  security.currentReferencedPrincipalCount,
              })}
            </td>
          </tr>
        </tbody>
      </MiniAppInfoTable>
      <MiniAppInfoHeading>
        {EXPLORER_LABELS.containerInfoPathHeading}
      </MiniAppInfoHeading>
      <MiniAppInfoTable>
        <thead>
          <tr>
            <th>{EXPLORER_LABELS.containerInfoPathColumn}</th>
            <th>{EXPLORER_LABELS.containerInfoManifestColumn}</th>
            <th>{EXPLORER_LABELS.containerInfoSecurityKeyEpochRow}</th>
            <th>{EXPLORER_LABELS.containerInfoRecipientsColumn}</th>
          </tr>
        </thead>
        <tbody>
          {security.path.map((entry) => (
            <tr key={`${entry.containerId}:${entry.manifestHash}`}>
              <td title={entry.containerId}>
                {containerNamesById.get(entry.containerId) ??
                  compactId(entry.containerId)}
              </td>
              <td title={entry.manifestHash}>
                <div>{compactId(entry.manifestHash)}</div>
                <code title={entry.eventHash}>
                  {getExplorerContainerInfoEventLabel(
                    compactId(entry.eventHash),
                  )}
                </code>
              </td>
              <td title={entry.containerKeyEpochId}>
                <div>{entry.containerKeyEpoch}</div>
                <code>{compactId(entry.containerKeyEpochId)}</code>
              </td>
              <td>
                {getExplorerContainerInfoRecipientSummaryLabel({
                  recipientTargetCount: entry.recipientTargetCount,
                  wrapCount: entry.wrapCount,
                })}
                <br />
                {getExplorerContainerInfoGrantSummaryLabel({
                  directGrantCount: entry.directGrantCount,
                  referencedPrincipalCount: entry.referencedPrincipalCount,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </MiniAppInfoTable>
    </MiniAppInfoSection>
  );
}
