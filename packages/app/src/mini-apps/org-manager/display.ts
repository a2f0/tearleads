import type {
  OrgManagerContainerGrant,
  OrgManagerGroupContainer,
} from "../../stores/org-manager/OrgManagerProvider";
import { ORG_MANAGER_LABELS } from "./labels";

const ACCESS_LEVEL_LABELS = {
  admin: ORG_MANAGER_LABELS.accessAdmin,
  read: ORG_MANAGER_LABELS.accessRead,
  write: ORG_MANAGER_LABELS.accessWrite,
} satisfies Record<OrgManagerGroupContainer["accessLevel"], string>;

export function compactFingerprint(value: string): string {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

export function getAccessLabel(
  accessLevel: OrgManagerGroupContainer["accessLevel"],
): string {
  return ACCESS_LEVEL_LABELS[accessLevel];
}

export function getGrantPrincipalLabel(
  grant: OrgManagerContainerGrant,
): string {
  if (grant.subjectType === "group") {
    return grant.groupName ?? compactFingerprint(grant.subjectId);
  }
  if (grant.subjectType === "organization") {
    return grant.organizationName ?? compactFingerprint(grant.subjectId);
  }

  return grant.userId
    ? compactFingerprint(grant.userId)
    : compactFingerprint(grant.subjectId);
}

export function getContainerDisplayLabel(
  container: Pick<
    OrgManagerGroupContainer,
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
    OrgManagerGroupContainer,
    "containerDisplayName" | "containerId"
  >,
): string {
  const displayName = container.containerDisplayName?.trim();

  return displayName && displayName.length > 0
    ? `${displayName} (${container.containerId})`
    : container.containerId;
}

export function isKeyboardActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
