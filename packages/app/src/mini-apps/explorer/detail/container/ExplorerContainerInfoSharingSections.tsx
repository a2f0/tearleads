import type {
  ContainerInfo,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import { MiniAppSelectMenu } from "../../../../components/mini-app/controls/MiniAppSelectMenu";
import {
  MiniAppButton,
  MiniAppFieldGroup,
  MiniAppInfoSection,
} from "../../../../components/mini-app/MiniAppLayout";
import { EXPLORER_LABELS } from "../../labels";
import type { MiniAppWindowPosition } from "../../types";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import {
  ExplorerContainerInfoGrantList,
  type ExplorerContainerInfoGrantRouteTarget,
  getContainerInfoPermissionLabel,
} from "./ExplorerContainerInfoGrantTable";
import type {
  ExplorerContainerInfoShareDraft,
  ExplorerShareSubjectType,
} from "./useExplorerContainerInfoPanelState";

const SHARE_SUBJECT_TYPE_OPTIONS = [
  {
    id: "group",
    label: EXPLORER_LABELS.containerInfoShareSubjectGroupOption,
  },
  {
    id: "user",
    label: EXPLORER_LABELS.containerInfoShareSubjectUserOption,
  },
] satisfies ReadonlyArray<{ id: ExplorerShareSubjectType; label: string }>;

function isContainerShareAccessLevel(
  value: string,
): value is ContainerShareAccessLevel {
  return value === "admin" || value === "read" || value === "write";
}

function isShareSubjectType(value: string): value is ExplorerShareSubjectType {
  return value === "group" || value === "user";
}
export function ExplorerContainerInfoPrincipalGrantsSection(params: {
  containerNamesById: ReadonlyMap<string, string>;
  remoteInfo: NonNullable<ContainerInfo["remoteInfo"]>;
  onOpenGrant: (
    grant: ExplorerContainerInfoGrantRouteTarget,
    position?: MiniAppWindowPosition,
  ) => void;
  resolveUserLabel: ExplorerAttributionUserLabelResolver | undefined;
}) {
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoPrincipalGrantsHeading}
    >
      <ExplorerContainerInfoGrantList
        containerNamesById={params.containerNamesById}
        containerInfo={params.remoteInfo}
        onOpenGrant={params.onOpenGrant}
        resolveUserLabel={params.resolveUserLabel}
      />
    </MiniAppInfoSection>
  );
}

// Picks the recipient kind, then the group or roster user, then the
// permission; the panel's Share button submits the pick.
export function ExplorerContainerInfoNewShareSection(params: {
  isSubmitting: boolean;
  setPanelError: (error: string | null) => void;
  shareDraft: ExplorerContainerInfoShareDraft;
}) {
  const { isSubmitting, setPanelError, shareDraft } = params;
  const isGroupShare = shareDraft.subjectType === "group";
  const recipientOptions = isGroupShare
    ? shareDraft.groupOptions
    : shareDraft.userOptions;
  const recipientField = isGroupShare
    ? EXPLORER_LABELS.containerInfoGroupField
    : EXPLORER_LABELS.containerInfoUserField;

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.containerInfoNewShareHeading}>
      <MiniAppFieldGroup>
        <span>{EXPLORER_LABELS.containerInfoShareSubjectField}</span>
        <MiniAppSelectMenu
          ariaLabel={EXPLORER_LABELS.containerInfoShareSubjectField}
          disabled={isSubmitting}
          value={shareDraft.subjectType}
          onChange={(value) => {
            setPanelError(null);
            if (isShareSubjectType(value)) {
              shareDraft.setSubjectType(value);
            }
          }}
          options={SHARE_SUBJECT_TYPE_OPTIONS}
        />
      </MiniAppFieldGroup>
      <MiniAppFieldGroup>
        <span>{recipientField}</span>
        <MiniAppSelectMenu
          ariaLabel={recipientField}
          disabled={isSubmitting || recipientOptions.length === 0}
          value={isGroupShare ? shareDraft.groupId : shareDraft.userId}
          onChange={(value) => {
            setPanelError(null);
            if (isGroupShare) {
              shareDraft.setGroupId(value);
            } else {
              shareDraft.setUserId(value);
            }
          }}
          options={recipientOptions}
          placeholder={
            isGroupShare
              ? EXPLORER_LABELS.containerInfoNoGroupsOption
              : shareDraft.userOptions.length === 0
                ? EXPLORER_LABELS.containerInfoNoUsersOption
                : EXPLORER_LABELS.containerInfoChooseUserOption
          }
        />
      </MiniAppFieldGroup>
      <MiniAppFieldGroup>
        <span>{EXPLORER_LABELS.containerInfoPermissionField}</span>
        <MiniAppSelectMenu
          ariaLabel={EXPLORER_LABELS.containerInfoPermissionField}
          disabled={isSubmitting || recipientOptions.length === 0}
          value={shareDraft.accessLevel}
          onChange={(accessLevel) => {
            setPanelError(null);
            if (isContainerShareAccessLevel(accessLevel)) {
              shareDraft.setAccessLevel(accessLevel);
            }
          }}
          options={(["read", "write", "admin"] as const).map((id) => ({
            id,
            label: getContainerInfoPermissionLabel(id),
          }))}
        />
      </MiniAppFieldGroup>
    </MiniAppInfoSection>
  );
}

export function ExplorerContainerInfoPeerShareSection(params: {
  isSubmitting: boolean;
  onShareWithPeer: () => void;
}) {
  const { isSubmitting, onShareWithPeer } = params;

  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.containerInfoShareToPeerHeading}
    >
      <MiniAppButton
        className="explorer-info-inline-action"
        disabled={isSubmitting}
        onClick={onShareWithPeer}
      >
        {EXPLORER_LABELS.containerInfoShareToPeerAction}
      </MiniAppButton>
    </MiniAppInfoSection>
  );
}
