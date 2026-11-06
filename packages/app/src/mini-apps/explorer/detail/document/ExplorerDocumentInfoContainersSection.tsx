import type { ContainerNode, DocumentInfo } from "@tearleads/client-sdk";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoEpochLabel,
  getExplorerDocumentInfoManifestLabel,
  getExplorerDocumentInfoPathLevelsLabel,
} from "../../labels";
import { compactId } from "../compactId";
import {
  ExplorerInfoContainerList,
  ExplorerInfoContainerRow,
  getGoToContainerAction,
} from "./ExplorerInfoContainerRow";

type AuthorizingContainerPath = NonNullable<
  DocumentInfo["remoteInfo"]
>["authorizingContainerPaths"][number];

// `2 levels · manifest abc… · epoch 4`; each part's title carries its full
// name and value, since the line itself is abbreviated.
function AuthorizingPathMetadata(props: { path: AuthorizingContainerPath }) {
  const { path } = props;
  const levels = getExplorerDocumentInfoPathLevelsLabel(path.pathLength);

  return (
    <>
      <span title={`${EXPLORER_LABELS.documentInfoPathLabel}: ${levels}`}>
        {levels}
      </span>
      {" · "}
      <span
        title={`${EXPLORER_LABELS.documentInfoManifestLabel}: ${path.leafManifestHash ?? "-"}`}
      >
        {getExplorerDocumentInfoManifestLabel(compactId(path.leafManifestHash))}
      </span>
      {path.containerKeyEpoch != null ? (
        <>
          {" · "}
          <span
            title={`${EXPLORER_LABELS.documentInfoKeyEpochLabel}: ${path.containerKeyEpochId ?? path.containerKeyEpoch}`}
          >
            {getExplorerDocumentInfoEpochLabel(path.containerKeyEpoch)}
          </span>
        </>
      ) : null}
    </>
  );
}

export function ExplorerDocumentInfoAuthorizingContainersSection(params: {
  containersById: ReadonlyMap<string, ContainerNode>;
  documentInfo: DocumentInfo;
  setSelectedId: (id: string | null) => void;
}) {
  const rows = params.documentInfo.remoteInfo?.authorizingContainerPaths ?? [];

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoAuthorizingContainersHeading}
    >
      <MiniAppStatus>
        {EXPLORER_LABELS.documentInfoAuthorizingContainersHint}
      </MiniAppStatus>
      {rows.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoAuthorizingContainers}
        </MiniAppStatus>
      ) : (
        <ExplorerInfoContainerList
          aria-label={EXPLORER_LABELS.documentInfoAuthorizingContainersHeading}
        >
          {rows.map((row) => {
            const container = params.containersById.get(row.containerId);
            return (
              <ExplorerInfoContainerRow
                actions={[
                  getGoToContainerAction({
                    available: container !== undefined,
                    containerId: row.containerId,
                    setSelectedId: params.setSelectedId,
                  }),
                ]}
                containerId={row.containerId}
                icon={container?.icon}
                key={`${row.containerId}:${row.leafManifestHash ?? ""}`}
                label={container?.name ?? compactId(row.containerId)}
                metadata={<AuthorizingPathMetadata path={row} />}
              />
            );
          })}
        </ExplorerInfoContainerList>
      )}
    </MiniAppInfoSection>
  );
}

// The Links tab's document-summary load state, shown above its sections.
export function ExplorerDocumentInfoLinksStatus(params: {
  documentSummaryError: string | null;
  isLoadingDocumentSummary: boolean;
}) {
  return (
    <>
      {params.isLoadingDocumentSummary ? (
        <MiniAppStatus>{EXPLORER_LABELS.documentInfoLoading}</MiniAppStatus>
      ) : null}
      {params.documentSummaryError ? (
        <MiniAppStatus tone="error">
          {params.documentSummaryError}
        </MiniAppStatus>
      ) : null}
    </>
  );
}
