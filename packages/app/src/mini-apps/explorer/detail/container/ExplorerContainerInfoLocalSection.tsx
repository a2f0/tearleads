import type { ContainerInfo, ContainerNode } from "@symcrypt/client-sdk";
import { useState } from "react";
import { MiniAppSelectMenu } from "../../../../components/mini-app/controls/MiniAppSelectMenu";
import {
  MiniAppFieldGroup,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../../components/mini-app/MiniAppTable";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import {
  getExplorerContainerIcon,
  SELECTABLE_CONTAINER_ICON_SLUGS,
  type SelectableContainerIconSlug,
  toSelectableContainerIconSlug,
  toStoredContainerIcon,
} from "../../shared/explorerContainerIcons";

const CONTAINER_ICON_OPTION_LABELS: Record<
  SelectableContainerIconSlug,
  string
> = {
  album: EXPLORER_LABELS.containerIconAlbumOption,
  folder: EXPLORER_LABELS.containerIconFolderOption,
  playlist: EXPLORER_LABELS.containerIconPlaylistOption,
};

function getContainerIconOptions() {
  return SELECTABLE_CONTAINER_ICON_SLUGS.map((slug) => {
    const containerIcon = getExplorerContainerIcon({
      icon: slug,
      isOpen: false,
    });
    const Icon = containerIcon.Component;
    return {
      icon: (
        <Icon
          aria-hidden
          className="mini-app-select-menu-icon"
          data-container-icon={containerIcon.containerIcon}
          data-icon={containerIcon.name}
          focusable="false"
          size={16}
          weight="regular"
        />
      ),
      id: slug,
      label: CONTAINER_ICON_OPTION_LABELS[slug],
    };
  });
}

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

  // Once the stored icon catches up to the optimistic pick, drop the pending
  // state so a later change from another client/device flows through instead of
  // staying masked by a stale pendingSlug. Adjusting state during render is the
  // React-endorsed way to reconcile derived state with new props.
  if (pendingSlug !== null && pendingSlug === currentSlug) {
    setPendingSlug(null);
  }

  const selectedSlug = pendingSlug ?? currentSlug;

  const handleChange = async (value: string) => {
    // The picker only offers the known slugs; normalize instead of asserting so
    // any unexpected value falls back to the default folder rather than lying to
    // the type system.
    const nextSlug = toSelectableContainerIconSlug(value);
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
      <MiniAppFieldGroup>
        <span>{EXPLORER_LABELS.containerIconField}</span>
        <MiniAppSelectMenu
          ariaLabel={EXPLORER_LABELS.containerIconField}
          className="explorer-container-icon-picker"
          disabled={isSaving}
          onChange={handleChange}
          options={getContainerIconOptions()}
          value={selectedSlug}
        />
      </MiniAppFieldGroup>
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
    <MiniAppInfoTable className="mini-app-info-table--borderless mini-app-info-table--pinned">
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
