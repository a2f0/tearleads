import type { ContainerInfo, ContainerNode } from "@tearleads/client-sdk";
import { type ChangeEvent, useState } from "react";
import {
  MiniAppField,
  MiniAppInfoSection,
  MiniAppSelect,
  MiniAppStatus,
} from "../../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../../components/shared/MiniAppTable";
import { formatMiniAppDateTime } from "../../../utils/formatMiniAppDate";
import {
  SELECTABLE_CONTAINER_ICON_SLUGS,
  type SelectableContainerIconSlug,
  toSelectableContainerIconSlug,
  toStoredContainerIcon,
} from "../explorerContainerIcons";
import { EXPLORER_LABELS } from "../labels";

const CONTAINER_ICON_OPTION_LABELS: Record<
  SelectableContainerIconSlug,
  string
> = {
  album: EXPLORER_LABELS.containerIconAlbumOption,
  folder: EXPLORER_LABELS.containerIconFolderOption,
  playlist: EXPLORER_LABELS.containerIconPlaylistOption,
};

function ExplorerContainerInfoIconField(params: {
  containerId: string;
  icon: string | null;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
}) {
  const { containerId, icon, setContainerIcon } = params;
  const currentSlug = toSelectableContainerIconSlug(icon);
  // Track the in-flight selection optimistically so the control reflects the
  // pick immediately while the metadata write and re-render settle. On failure
  // it reverts to null so the select falls back to the stored value.
  const [pendingSlug, setPendingSlug] =
    useState<SelectableContainerIconSlug | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedSlug = pendingSlug ?? currentSlug;

  const handleChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    // The select only offers the known slugs; normalize instead of asserting so
    // any unexpected value falls back to the default folder rather than lying to
    // the type system.
    const nextSlug = toSelectableContainerIconSlug(event.target.value);
    setPendingSlug(nextSlug);
    setIsSaving(true);
    setError(null);
    try {
      const result = await setContainerIcon(
        containerId,
        toStoredContainerIcon(nextSlug),
      );
      if (!result) {
        setPendingSlug(null);
        setError(EXPLORER_LABELS.containerIconUpdateFailure);
      }
    } catch {
      setPendingSlug(null);
      setError(EXPLORER_LABELS.containerIconUpdateFailure);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.containerIconHeading}>
      <MiniAppField>
        <span>{EXPLORER_LABELS.containerIconField}</span>
        <MiniAppSelect
          aria-label={EXPLORER_LABELS.containerIconField}
          disabled={isSaving}
          value={selectedSlug}
          onChange={handleChange}
        >
          {SELECTABLE_CONTAINER_ICON_SLUGS.map((slug) => (
            <option key={slug} value={slug}>
              {CONTAINER_ICON_OPTION_LABELS[slug]}
            </option>
          ))}
        </MiniAppSelect>
      </MiniAppField>
      {error ? <MiniAppStatus tone="error">{error}</MiniAppStatus> : null}
    </MiniAppInfoSection>
  );
}

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
  canManageIcon: boolean;
  containerIcon: string | null;
  containerId: string;
  containerInfo: ContainerInfo | null;
  setContainerIcon: (
    containerId: string,
    icon: string | null,
  ) => Promise<ContainerNode | null>;
}) {
  const { canManageIcon, containerIcon, containerId, containerInfo } = params;

  return (
    <>
      {canManageIcon ? (
        <ExplorerContainerInfoIconField
          containerId={containerId}
          icon={containerIcon}
          setContainerIcon={params.setContainerIcon}
        />
      ) : null}
      <MiniAppInfoSection
        heading={EXPLORER_LABELS.containerInfoLocalDetailsHeading}
      >
        <ExplorerContainerInfoLocalDetails
          containerId={containerId}
          containerInfo={containerInfo}
        />
      </MiniAppInfoSection>
    </>
  );
}
