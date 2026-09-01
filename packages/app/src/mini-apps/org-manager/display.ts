import type {
  OrganizationContainerGrant,
  OrganizationGroupContainer,
} from "@tearleads/client-sdk";
import { ORG_MANAGER_LABELS } from "./labels";

const ACCESS_LEVEL_LABELS = {
  admin: ORG_MANAGER_LABELS.accessAdmin,
  read: ORG_MANAGER_LABELS.accessRead,
  write: ORG_MANAGER_LABELS.accessWrite,
} satisfies Record<OrganizationGroupContainer["accessLevel"], string>;

// Shared empty default for `profileDisplayNamesByUserId` props/params across
// the org-manager views, so they don't each allocate an identical empty Map.
export const EMPTY_PROFILE_DISPLAY_NAMES: ReadonlyMap<string, string> = new Map<
  string,
  string
>();

export function compactFingerprint(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

export function getAccessLabel(
  accessLevel: OrganizationGroupContainer["accessLevel"],
): string {
  return ACCESS_LEVEL_LABELS[accessLevel];
}

export function getGrantPrincipalLabel(
  grant: OrganizationContainerGrant,
): string {
  if (grant.subjectType === "group") {
    return grant.groupName ?? compactFingerprint(grant.subjectId);
  }

  return grant.userId
    ? compactFingerprint(grant.userId)
    : compactFingerprint(grant.subjectId);
}

export function getContainerDisplayLabel(
  container: Pick<
    OrganizationGroupContainer,
    "containerDisplayName" | "containerId"
  >,
): string {
  const displayName = container.containerDisplayName?.trim();

  return displayName && displayName.length > 0
    ? displayName
    : compactFingerprint(container.containerId);
}

export function getContainerDisplayTitle(
  container: Pick<
    OrganizationGroupContainer,
    "containerDisplayName" | "containerId"
  >,
): string {
  const displayName = container.containerDisplayName?.trim();

  return displayName && displayName.length > 0
    ? `${displayName} (${container.containerId})`
    : container.containerId;
}
